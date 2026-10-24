import { _decorator, Component, Node, UITransform, Sprite, SpriteFrame, Layers, v3, EventTouch, tween } from 'cc';
import { BoardConfig } from './BoardConfig';
const { ccclass, property } = _decorator;

/**
 * 生成器点击代理接口
 */
export interface IGeneratorDelegate {
    onGeneratorClicked(generator: GeneratorView): void;
}

/**
 * 棋盘固定生成器组件
 * 独立于普通物品，固定在特定网格上，不参与拖拽、交换和合成
 */
@ccclass('GeneratorView')
export class GeneratorView extends Component {
    /** 生成器所在的网格列坐标 (0 ~ 6) */
    public col: number = -1;

    /** 生成器所在的网格行坐标 (0 ~ 8) */
    public row: number = -1;

    /** 点击事件回调委托（通常为 BoardView） */
    public delegate: IGeneratorDelegate | null = null;

    /** 精灵渲染组件 */
    private _sprite: Sprite | null = null;

    /** 防连点标志 */
    private _isClicking: boolean = false;

    protected onLoad(): void {
        this.node.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
    }

    protected onDestroy(): void {
        this.node.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
    }

    /**
     * 初始化生成器视图与位置
     * @param col 列坐标
     * @param row 行坐标
     * @param spriteFrame 生成器素材帧 (assets/Art/generator/1.png)
     */
    public init(col: number, row: number, spriteFrame?: SpriteFrame | null): void {
        this.col = col;
        this.row = row;

        this.node.layer = Layers.Enum.UI_2D;

        // 设置 UITransform 尺寸 (设为 126x126，即格子的 90%，协调美观)
        let uiTransform = this.getComponent(UITransform);
        if (!uiTransform) {
            uiTransform = this.addComponent(UITransform);
        }
        const genSize = BoardConfig.CELL_SIZE * 0.9;
        uiTransform.setContentSize(genSize, genSize);

        // 初始化 Sprite
        if (!this._sprite) {
            this._sprite = this.addComponent(Sprite);
        }
        this._sprite.type = Sprite.Type.SIMPLE;
        this._sprite.sizeMode = Sprite.SizeMode.CUSTOM;

        if (spriteFrame) {
            this._sprite.spriteFrame = spriteFrame;
        }

        // 定位到棋盘指定格子
        const localPos = BoardConfig.gridToLocal(col, row);
        this.node.setPosition(localPos);
    }

    /**
     * 点击处理（带微弹性视觉反馈与防重触发锁）
     */
    private _onTouchEnd(event: EventTouch): void {
        if (this._isClicking) {
            return;
        }
        this._isClicking = true;

        // 点击 Q 弹反馈动画：缩放到 0.9 再弹回 1.05 再回到 1.0
        tween(this.node)
            .to(0.06, { scale: v3(0.9, 0.9, 1) })
            .to(0.08, { scale: v3(1.06, 1.06, 1) })
            .to(0.06, { scale: v3(1.0, 1.0, 1) })
            .call(() => {
                this._isClicking = false;
            })
            .start();

        if (this.delegate) {
            this.delegate.onGeneratorClicked(this);
        }
    }
}
