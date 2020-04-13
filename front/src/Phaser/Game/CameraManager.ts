import {RESOLUTION} from "../../Enum/EnvironmentVariable";
import {Player} from "../Player/Player";
import {GameSceneInterface} from "./GameScene";

export interface CameraManagerInterface {
    moveCamera(CurrentPlayer : Player) : void;
}

export class CameraManager implements CameraManagerInterface{
    Scene : GameSceneInterface;
    Camera : Phaser.Cameras.Scene2D.Camera;

    constructor(
        Scene: GameSceneInterface,
        Camera : Phaser.Cameras.Scene2D.Camera,
    ) {
        this.Scene = Scene;
        this.Camera = Camera;
    }

    moveCamera(CurrentPlayer : Player): void {
        //center of camera
        let startX = ((window.innerWidth / 2) / RESOLUTION);
        let startY = ((window.innerHeight / 2) / RESOLUTION);

        let limit = {
            top: startY,
            left: startX,
            bottom : this.Scene.Map.heightInPixels - startY,
            right: this.Scene.Map.widthInPixels - startX,
        };

        if(CurrentPlayer.x < limit.left){
            this.Camera.scrollX = 0;
        }else if(CurrentPlayer.x > limit.right){
            this.Camera.scrollX = (limit.right - startX);
        }else {
            this.Camera.scrollX = (CurrentPlayer.x - startX);
        }

        if(CurrentPlayer.y < limit.top){
            this.Camera.scrollY = 0;
        }else if(CurrentPlayer.y > limit.bottom){
            this.Camera.scrollY = (limit.bottom - startY);
        }else {
            this.Camera.scrollY = (CurrentPlayer.y - startY);
        }
    }
}