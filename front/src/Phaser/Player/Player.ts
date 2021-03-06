import {getPlayerAnimations, playAnimation, PlayerAnimationNames} from "./Animation";
import {GameSceneInterface, Textures} from "../Game/GameScene";
import {MessageUserPositionInterface} from "../../Connexion";
import {ActiveEventList, UserInputEvent, UserInputManager} from "../UserInput/UserInputManager";
import {PlayableCaracter} from "../Entity/PlayableCaracter";


export const hasMovedEventName = "hasMoved";
export interface CurrentGamerInterface extends PlayableCaracter{
    userId : string;
    initAnimation() : void;
    moveUser(delta: number) : void;
    say(text : string) : void;
}

export interface GamerInterface extends PlayableCaracter{
    userId : string;
    initAnimation() : void;
    updatePosition(MessageUserPosition : MessageUserPositionInterface) : void;
    say(text : string) : void;
}

export class Player extends PlayableCaracter implements CurrentGamerInterface, GamerInterface {
    userId: string;
    userInputManager: UserInputManager;
    previousMove: string;

    constructor(
        userId: string,
        Scene: GameSceneInterface,
        x: number,
        y: number,
        name: string,
        PlayerTexture: string = Textures.Player
    ) {
        super(Scene, x, y, PlayerTexture, name, 1);

        //create input to move
        this.userInputManager = new UserInputManager(Scene);

        //set data
        this.userId = userId;

        //the current player model should be push away by other players to prevent conflict
        this.setImmovable(false);
    }

    initAnimation(): void {
        getPlayerAnimations(this.PlayerTexture).forEach(d => {
            this.scene.anims.create({
                key: d.key,
                frames: this.scene.anims.generateFrameNumbers(d.frameModel, {start: d.frameStart, end: d.frameEnd}),
                frameRate: d.frameRate,
                repeat: d.repeat
            });
        })
    }

    moveUser(delta: number): void {
        //if user client on shift, camera and player speed
        let direction = null;

        let activeEvents = this.userInputManager.getEventListForGameTick();
        let speedMultiplier = activeEvents.get(UserInputEvent.SpeedUp) ? 25 : 9;
        let moveAmount = speedMultiplier * 20;

        let x = 0;
        let y = 0;
        if (activeEvents.get(UserInputEvent.MoveUp)) {
            y = - moveAmount;
            direction = `${this.PlayerTexture}-${PlayerAnimationNames.WalkUp}`;
        } else if (activeEvents.get(UserInputEvent.MoveDown)) {
            y = moveAmount;
            direction = `${this.PlayerTexture}-${PlayerAnimationNames.WalkDown}`;
        }
        if (activeEvents.get(UserInputEvent.MoveLeft)) {
            x = -moveAmount;
            direction = `${this.PlayerTexture}-${PlayerAnimationNames.WalkLeft}`;
        } else if (activeEvents.get(UserInputEvent.MoveRight)) {
            x = moveAmount;
            direction = `${this.PlayerTexture}-${PlayerAnimationNames.WalkRight}`;
        }
        if (x !== 0 || y !== 0) {
            this.move(x, y);
            this.emit(hasMovedEventName, {direction, x: this.x, y: this.y, character: this.PlayerTexture});
        } else {
            if (this.previousMove !== PlayerAnimationNames.None) {
                direction = PlayerAnimationNames.None;
                this.stop();
                this.emit(hasMovedEventName, {direction, x: this.x, y: this.y, character: this.PlayerTexture});
            }
        }

        if (direction !== null) {
            this.previousMove = direction;
        }
    }

    //todo: put this method into the NonPlayer class instead
    updatePosition(MessageUserPosition: MessageUserPositionInterface) {
        playAnimation(this, MessageUserPosition.position.direction);
        this.setX(MessageUserPosition.position.x);
        this.setY(MessageUserPosition.position.y);
        this.setDepth(MessageUserPosition.position.y);
    }
}
