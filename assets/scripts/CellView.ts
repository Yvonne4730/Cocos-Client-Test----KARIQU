import { _decorator, Component, UITransform, Graphics, Color, Sprite, SpriteFrame } from 'cc';
import { BoardConfig } from './BoardConfig';
const { ccclass, property } = _decorator;

/**
 * 棋盘单个单元格视图组件
 * 负责记录 (col, row) 坐标并渲染底格背景
 */
@ccclass('CellView')
export class CellView extends Component {
    /** 单元格列坐标 (0 ~ 6) */
    public col: number = 0;

    /** 单元格行坐标 (0 ~ 8) */
    public row: number = 0;

    /** 矢量绘制组件 (用于零资源依赖的高保真色块渲染) */
    private _graphics: Graphics | null = null;

    /** 精灵组件 (供后续贴图扩展) */
    private _sprite: Sprite | null = null;

    /**
     * 初始化单元格数据与显示
     * @param col 列索引
     * @param row 行索引
     * @param spriteFrame 可选的单格贴图
     */
    public init(col: number, row: number, spriteFrame?: SpriteFrame | null): void {
        this.col = col;
        this.row = row;

        // 确保本节点具备精确的 140x140 UITransform
        let uiTransform = this.getComponent(UITransform);
        if (!uiTransform) {
            uiTransform = this.addComponent(UITransform);
        }
        uiTransform.setContentSize(BoardConfig.CELL_SIZE, BoardConfig.CELL_SIZE);

        if (spriteFrame) {
            this._renderWithSprite(spriteFrame);
        } else {
            this._renderWithGraphics();
        }
    }

    /**
     * 使用 Graphics 矢量组件绘制棋盘底格
     * 采用原题美术色板：
     * - 深色格: #D1DDDF (RGB 209, 221, 223)，对应 cell_bg 不透明区
     * - 浅色格: #E1E7E8 (RGB 225, 231, 232)，对应 frame 底板中心色
     * - 细边框: #B5CBD1 (RGB 181, 203, 209)
     */
    private _renderWithGraphics(): void {
        if (!this._graphics) {
            this._graphics = this.addComponent(Graphics);
        }
        const g = this._graphics;
        g.clear();

        const size = BoardConfig.CELL_SIZE;
        const half = size / 2;

        // 棋盘经典的奇偶交错双色
        const isDark = (this.col + this.row) % 2 === 0;
        const fillColor = isDark
            ? new Color(209, 221, 223, 255)
            : new Color(225, 231, 232, 255);
        const strokeColor = new Color(181, 203, 209, 255);

        // 填充底格 (中心对齐坐标: -half 到 half)
        g.fillColor = fillColor;
        g.roundRect(-half, -half, size, size, 4);
        g.fill();

        // 绘制轮廓线，确保 63 个格子边界清晰可见
        g.strokeColor = strokeColor;
        g.lineWidth = 1.5;
        g.roundRect(-half, -half, size, size, 4);
        g.stroke();
    }

    /**
     * 使用 Sprite 精灵组件呈现单格贴图 (Sprite.Type.SIMPLE)
     */
    private _renderWithSprite(spriteFrame: SpriteFrame): void {
        if (!this._sprite) {
            this._sprite = this.addComponent(Sprite);
        }
        this._sprite.spriteFrame = spriteFrame;
        this._sprite.type = Sprite.Type.SIMPLE;
        this._sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    }
}
