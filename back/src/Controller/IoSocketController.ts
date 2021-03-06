import socketIO = require('socket.io');
import {Socket} from "socket.io";
import * as http from "http";
import {MessageUserPosition} from "../Model/Websocket/MessageUserPosition"; //TODO fix import by "_Model/.."
import {ExSocketInterface} from "../Model/Websocket/ExSocketInterface"; //TODO fix import by "_Model/.."
import Jwt, {JsonWebTokenError} from "jsonwebtoken";
import {SECRET_KEY, MINIMUM_DISTANCE, GROUP_RADIUS} from "../Enum/EnvironmentVariable"; //TODO fix import by "_Enum/..."
import {ExtRooms, RefreshUserPositionFunction} from "../Model/Websocket/ExtRooms";
import {ExtRoomsInterface} from "../Model/Websocket/ExtRoomsInterface";
import {World} from "../Model/World";
import {Group} from "_Model/Group";
import {UserInterface} from "_Model/UserInterface";

enum SockerIoEvent {
    CONNECTION = "connection",
    DISCONNECT = "disconnect",
    JOIN_ROOM = "join-room",
    USER_POSITION = "user-position",
    WEBRTC_SIGNAL = "webrtc-signal",
    WEBRTC_OFFER = "webrtc-offer",
    WEBRTC_START = "webrtc-start",
    WEBRTC_DISCONNECT = "webrtc-disconect",
    MESSAGE_ERROR = "message-error",
    GROUP_CREATE_UPDATE = "group-create-update",
    GROUP_DELETE = "group-delete",
}

export class IoSocketController {
    Io: socketIO.Server;
    Worlds: Map<string, World> = new Map<string, World>();

    constructor(server: http.Server) {
        this.Io = socketIO(server);

        // Authentication with token. it will be decoded and stored in the socket.
        this.Io.use((socket: Socket, next) => {
            if (!socket.handshake.query || !socket.handshake.query.token) {
                return next(new Error('Authentication error'));
            }
            if(this.searchClientByToken(socket.handshake.query.token)){
                return next(new Error('Authentication error'));
            }
            Jwt.verify(socket.handshake.query.token, SECRET_KEY, (err: JsonWebTokenError, tokenDecoded: object) => {
                if (err) {
                    return next(new Error('Authentication error'));
                }
                (socket as ExSocketInterface).token = tokenDecoded;
                next();
            });
        });

        this.ioConnection();
        this.shareUsersPosition();
    }

    private sendUpdateGroupEvent(group: Group): void {
        // Let's get the room of the group. To do this, let's get anyone in the group and find its room.
        // Note: this is suboptimal
        let userId = group.getUsers()[0].id;
        let client: ExSocketInterface|null = this.searchClientById(userId);
        if (client === null) {
            return;
        }
        let roomId = client.roomId;
        this.Io.in(roomId).emit(SockerIoEvent.GROUP_CREATE_UPDATE, {
            position: group.getPosition(),
            groupId: group.getId()
        });
    }

    private sendDeleteGroupEvent(uuid: string, lastUser: UserInterface): void {
        // Let's get the room of the group. To do this, let's get anyone in the group and find its room.
        // Note: this is suboptimal
        let userId = lastUser.id;
        let client: ExSocketInterface|null = this.searchClientById(userId);
        if (client === null) {
            return;
        }
        let roomId = client.roomId;
        this.Io.in(roomId).emit(SockerIoEvent.GROUP_DELETE, uuid);
    }

    ioConnection() {
        this.Io.on(SockerIoEvent.CONNECTION, (socket: Socket) => {
            /*join-rom event permit to join one room.
                message :
                    userId : user identification
                    roomId: room identification
                    position: position of user in map
                        x: user x position on map
                        y: user y position on map
            */
            socket.on(SockerIoEvent.JOIN_ROOM, (message: string) => {
                try {
                    let messageUserPosition = this.hydrateMessageReceive(message);
                    if (messageUserPosition instanceof Error) {
                        return socket.emit(SockerIoEvent.MESSAGE_ERROR, JSON.stringify({message: messageUserPosition.message}))
                    }

                    let Client = (socket as ExSocketInterface);

                    if(Client.roomId === messageUserPosition.roomId){
                        return;
                    }

                    //leave previous room
                    this.leaveRoom(Client);

                    //join new previous room
                    this.joinRoom(Client, messageUserPosition);

                    // sending to all clients in room except sender
                    this.saveUserInformation(Client, messageUserPosition);

                    //add function to refresh position user in real time.
                    this.refreshUserPosition(Client);

                    socket.to(messageUserPosition.roomId).emit(SockerIoEvent.JOIN_ROOM, messageUserPosition.toString());
                } catch (e) {
                    console.error('An error occurred on "join_room" event');
                    console.error(e);
                }
            });

            socket.on(SockerIoEvent.USER_POSITION, (message: string) => {
                try {
                    let messageUserPosition = this.hydrateMessageReceive(message);
                    if (messageUserPosition instanceof Error) {
                        return socket.emit(SockerIoEvent.MESSAGE_ERROR, JSON.stringify({message: messageUserPosition.message}));
                    }

                    let Client = (socket as ExSocketInterface);

                    // sending to all clients in room except sender
                    this.saveUserInformation(Client, messageUserPosition);

                    //refresh position of all user in all rooms in real time
                    this.refreshUserPosition(Client);
                } catch (e) {
                    console.error('An error occurred on "user_position" event');
                    console.error(e);
                }
        });

            socket.on(SockerIoEvent.WEBRTC_SIGNAL, (message: string) => {
                let data: any = JSON.parse(message);
                //send only at user
                let client = this.searchClientById(data.receiverId);
                if (!client) {
                    console.error("client doesn't exist for ", data.receiverId);
                    return;
                }
                return client.emit(SockerIoEvent.WEBRTC_SIGNAL, message);
            });

            socket.on(SockerIoEvent.WEBRTC_OFFER, (message: string) => {
                let data: any = JSON.parse(message);

                //send only at user
                let client = this.searchClientById(data.receiverId);
                if (!client) {
                    console.error("client doesn't exist for ", data.receiverId);
                    return;
                }
                client.emit(SockerIoEvent.WEBRTC_OFFER, message);
            });

            socket.on(SockerIoEvent.DISCONNECT, () => {
                try {
                    let Client = (socket as ExSocketInterface);
                    this.sendDisconnectedEvent(Client);

                    //refresh position of all user in all rooms in real time
                    this.refreshUserPosition(Client);

                    //leave room
                    this.leaveRoom(Client);

                    //leave webrtc room
                    socket.leave(Client.webRtcRoomId);

                    //delete all socket information
                    delete Client.userId;
                    delete Client.webRtcRoomId;
                    delete Client.roomId;
                    delete Client.token;
                    delete Client.position;
                } catch (e) {
                    console.error('An error occurred on "disconnect"');
                    console.error(e);
                }
            });
        });
    }

    /**
     * TODO: each call to this method is suboptimal. It means that instead of passing an ID, we should pass a client object.
     * @param userId
     */
    searchClientById(userId: string): ExSocketInterface | null {
        let clients: Array<any> = Object.values(this.Io.sockets.sockets);
        for (let i = 0; i < clients.length; i++) {
            let client: ExSocketInterface = clients[i];
            if (client.userId !== userId) {
                continue
            }
            return client;
        }
        return null;
    }

    /**
     * @param userId
     */
    searchClientByToken(userId: string): ExSocketInterface | null {
        let clients: Array<any> = Object.values(this.Io.sockets.sockets);
        for (let i = 0; i < clients.length; i++) {
            let client: ExSocketInterface = clients[i];
            if (client.userId !== userId) {
                continue
            }
            return client;
        }
        return null;
    }

    /**
     *
     * @param Client: ExSocketInterface
     */
    sendDisconnectedEvent(Client: ExSocketInterface) {
        Client.broadcast.emit(SockerIoEvent.WEBRTC_DISCONNECT, JSON.stringify({
            userId: Client.userId
        }));

        //disconnect webrtc room
        if(!Client.webRtcRoomId){
            return;
        }
        Client.leave(Client.webRtcRoomId);
        delete Client.webRtcRoomId;
    }

    /**
     *
     * @param Client
     */
    leaveRoom(Client : ExSocketInterface){
        //lease previous room and world
        if(Client.roomId){
            //user leave previous room
            Client.leave(Client.roomId);
            //user leave previous world
            let world : World|undefined = this.Worlds.get(Client.roomId);
            if(world){
                world.leave(Client);
                this.Worlds.set(Client.roomId, world);
            }
        }
    }
    /**
     *
     * @param Client
     * @param messageUserPosition
     */
    joinRoom(Client : ExSocketInterface, messageUserPosition: MessageUserPosition){
        //join user in room
        Client.join(messageUserPosition.roomId);

        //check and create new world for a room
        if(!this.Worlds.get(messageUserPosition.roomId)){
            let world = new World((user1: string, group: Group) => {
                this.connectedUser(user1, group);
            }, (user1: string, group: Group) => {
                this.disConnectedUser(user1, group);
            }, MINIMUM_DISTANCE, GROUP_RADIUS, (group: Group) => {
                this.sendUpdateGroupEvent(group);
            }, (groupUuid: string, lastUser: UserInterface) => {
                this.sendDeleteGroupEvent(groupUuid, lastUser);
            });
            this.Worlds.set(messageUserPosition.roomId, world);
        }

        //join world
        let world : World|undefined = this.Worlds.get(messageUserPosition.roomId);
        if(world) {
            world.join(messageUserPosition);
            this.Worlds.set(messageUserPosition.roomId, world);
        }
    }

    /**
     *
     * @param socket
     * @param roomId
     */
    joinWebRtcRoom(socket: ExSocketInterface, roomId: string) {
        if (socket.webRtcRoomId === roomId) {
            return;
        }
        socket.join(roomId);
        socket.webRtcRoomId = roomId;
        //if two persons in room share
        if (this.Io.sockets.adapter.rooms[roomId].length < 2 /*|| this.Io.sockets.adapter.rooms[roomId].length >= 4*/) {
            return;
        }
        let clients: Array<ExSocketInterface> = (Object.values(this.Io.sockets.sockets) as Array<ExSocketInterface>)
            .filter((client: ExSocketInterface) => client.webRtcRoomId && client.webRtcRoomId === roomId);
        //send start at one client to initialise offer webrtc
        //send all users in room to create PeerConnection in front
        clients.forEach((client: ExSocketInterface, index: number) => {

            let clientsId = clients.reduce((tabs: Array<any>, clientId: ExSocketInterface, indexClientId: number) => {
                if (!clientId.userId || clientId.userId === client.userId) {
                    return tabs;
                }
                tabs.push({
                    userId: clientId.userId,
                    initiator: index <= indexClientId
                });
                return tabs;
            }, []);

            client.emit(SockerIoEvent.WEBRTC_START, JSON.stringify({clients: clientsId, roomId: roomId}));
        });
    }

    //permit to save user position in socket
    saveUserInformation(socket: ExSocketInterface, message: MessageUserPosition) {
        socket.position = message.position;
        socket.roomId = message.roomId;
        socket.userId = message.userId;
        socket.name = message.name;
        socket.character = message.character;
    }

    refreshUserPosition(Client : ExSocketInterface) {
        //refresh position of all user in all rooms in real time
        let rooms = (this.Io.sockets.adapter.rooms as ExtRoomsInterface);
        if (!rooms.refreshUserPosition) {
            rooms.refreshUserPosition = RefreshUserPositionFunction;
        }
        rooms.refreshUserPosition(rooms, this.Io);

        // update position in the worl
        let data = {
            userId: Client.userId,
            roomId: Client.roomId,
            position: Client.position,
            name: Client.name,
            character: Client.character,
        };
        let messageUserPosition = new MessageUserPosition(data);
        let world = this.Worlds.get(messageUserPosition.roomId);
        if (!world) {
            return;
        }
        world.updatePosition(messageUserPosition);
        this.Worlds.set(messageUserPosition.roomId, world);
    }

    //Hydrate and manage error
    hydrateMessageReceive(message: string): MessageUserPosition | Error {
        try {
            return new MessageUserPosition(JSON.parse(message));
        } catch (err) {
            //TODO log error
            return new Error(err);
        }
    }

    /** permit to share user position
     ** users position will send in event 'user-position'
     ** The data sent is an array with information for each user :
     [
     {
            userId: <string>,
            roomId: <string>,
            position: {
                x : <number>,
                y : <number>,
               direction: <string>
            }
          },
     ...
     ]
     **/
    seTimeOutInProgress: any = null;

    shareUsersPosition() {
        if (this.seTimeOutInProgress) {
            clearTimeout(this.seTimeOutInProgress);
        }
        //send for each room, all data of position user
        let arrayMap = (this.Io.sockets.adapter.rooms as ExtRooms).userPositionMapByRoom;
        if (!arrayMap) {
            this.seTimeOutInProgress = setTimeout(() => {
                this.shareUsersPosition();
            }, 10);
            return;
        }
        arrayMap.forEach((value: any) => {
            let roomId = value[0];
            this.Io.in(roomId).emit(SockerIoEvent.USER_POSITION, JSON.stringify(value));
        });
        this.seTimeOutInProgress = setTimeout(() => {
            this.shareUsersPosition();
        }, 10);
    }

    //connected user
    connectedUser(userId: string, group: Group) {
        let Client = this.searchClientById(userId);
        if (!Client) {
            return;
        }
        this.joinWebRtcRoom(Client, group.getId());
    }

    //disconnect user
    disConnectedUser(userId: string, group: Group) {
        let Client = this.searchClientById(userId);
        if (!Client) {
            return;
        }
        this.sendDisconnectedEvent(Client)
    }
}
