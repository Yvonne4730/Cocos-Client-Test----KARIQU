import { _decorator, Component, Node, UITransform, Sprite, SpriteFrame, Layers, EventTouch, Vec3, v3 } from 'cc';
import { BoardConfig } from './BoardConfig';
const { ccclass, property } = _decorator;

/**
 * 物品拖拽回调委托接口
 */
export interface IItemDragDelegate {
    /** 尝试将物品移动到目标行列 */
    tryMoveItem(item: ItemView, targetCol: number, targetRow: number): boolean;
}

/**
 * 物品视图组件
 * 负责单个物品的数据（type, level）与图片渲染，以及鼠标/触摸交互拖拽
 */
@ccclass('ItemView')
export class ItemView extends Component {
    /** 物品所属类型，例如 "clothes" */
    public itemType: string = '';

    /** 物品等级，例如 1 ~ 12 */
    public level: number = 1;

    /** 物品当前所在的格子列索引 (0 ~ 6) */
    public col: number = -1;

    /** 物品当前所在的格子行索引 (0 ~ 8) */
    public row: number = -1;

    /** 拖拽委托对象（通常为 BoardView） */
    public dragDelegate: IItemDragDelegate | null = null;

    /** 精灵渲染组件 */
    private _sprite: Sprite | null = null;

    /** 记录拖拽开始时的原始局部坐标 */
    private _originLocalPos: Vec3 = new Vec3();

    /** 是否处于正在被拖拽状态 */
    private _isDragging: boolean = false;

    /** 临时 Vec3 缓存，减少 GC */
    private _tempWorldPos: Vec3 = new Vec3();
    private _tempLocalPos: Vec3 = new Vec3();

    protected onLoad(): void {
        this._registerEvents();
    }

    protected onDestroy(): void {
        this._unregisterEvents();
    }

    protected onDisable(): void {
        // 异常失活或中断时安全回弹
        if (this._isDragging) {
            this._resetToOrigin();
        }
    }

    /**
     * 注册事件监听：Node.EventType.TOUCH_* 在 Cocos Creator 3.8.x 中通用支持鼠标拖拽与触摸拖拽
     */
    private _registerEvents(): void {
        this.node.on(Node.EventType.TOUCH_START, this._onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    private _unregisterEvents(): void {
        this.node.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
        this.node.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    /**
     * 初始化物品数据与显示
     */
    public init(itemType: string, level: number, col: number, row: number, spriteFrame?: SpriteFrame | null): void {
        this.itemType = itemType;
        this.level = level;
        this.col = col;
        this.row = row;

        this.node.layer = Layers.Enum.UI_2D;

        let uiTransform = this.getComponent(UITransform);
        if (!uiTransform) {
            uiTransform = this.addComponent(UITransform);
        }
        const itemSize = BoardConfig.CELL_SIZE * 0.86; // 140 * 0.86 ≈ 120
        uiTransform.setContentSize(itemSize, itemSize);

        if (!this._sprite) {
            this._sprite = this.addComponent(Sprite);
        }
        this._sprite.type = Sprite.Type.SIMPLE;
        this._sprite.sizeMode = Sprite.SizeMode.CUSTOM;

        if (spriteFrame) {
            this._sprite.spriteFrame = spriteFrame;
        }

        // 保存初始位置
        this._originLocalPos.set(this.node.position);
    }

    /**
     * 触摸/鼠标按下：记录原位并置于最前
     */
    private _onTouchStart(event: EventTouch): void {
        this._isDragging = true;
        this._originLocalPos.set(this.node.position);

        // 动态提升至父容器兄弟节点最顶层，使用合法索引避免硬编码越界
        const parent = this.node.parent;
        if (parent && parent.children.length > 1) {
            const topIndex = parent.children.length - 1;
            this.node.setSiblingIndex(topIndex);
        }

        // 略微放大提供按压视觉反馈
        this.node.setScale(v3(1.15, 1.15, 1));
    }

    /**
     * 触摸/鼠标移动：将 UI 屏幕坐标精确换算至 ItemsContainer 本地坐标，平滑跟随指针
     */
    private _onTouchMove(event: EventTouch): void {
        if (!this._isDragging || !this.node.parent) {
            return;
        }

        const parentUI = this.node.parent.getComponent(UITransform);
        if (!parentUI) {
            return;
        }

        // 获取触摸点在 UI 世界坐标系中的位置
        const uiLoc = event.getUILocation();
        this._tempWorldPos.set(uiLoc.x, uiLoc.y, 0);

        // 精确转换为父级容器的本地坐标，自动抵消父节点 Canvas、Board 的任意 scale 与位置偏移
        parentUI.convertToNodeSpaceAR(this._tempWorldPos, this._tempLocalPos);
        this.node.setPosition(this._tempLocalPos);
    }

    /**
     * 触摸/鼠标松开：计算目标格并请求放置
     */
    private _onTouchEnd(event: EventTouch): void {
        if (!this._isDragging) {
            return;
        }
        this._isDragging = false;
        this.node.setScale(v3(1, 1, 1));

        // 根据当前松开时的本地坐标计算目标行列
        const pos = this.node.position;
        const result = BoardConfig.localToGrid(pos.x, pos.y);

        let moveSuccess = false;
        if (result.isValid && this.dragDelegate) {
            moveSuccess = this.dragDelegate.tryMoveItem(this, result.col, result.row);
        }

        if (!moveSuccess) {
            this._resetToOrigin();
        }
    }

    /**
     * 触摸取消或中断
     */
    private _onTouchCancel(event: EventTouch): void {
        if (!this._isDragging) {
            return;
        }
        this._resetToOrigin();
    }

    /**
     * 恢复到起始格子位置
     */
    private _resetToOrigin(): void {
        this._isDragging = false;
        this.node.setScale(v3(1, 1, 1));
        this.node.setPosition(this._originLocalPos);
    }

    /**
     * 更新物品绑定的网格坐标（由 BoardView 确认移动成功后调用）
     */
    public setGridPosition(col: number, row: number): void {
        this.col = col;
        this.row = row;
        const localPos = BoardConfig.gridToLocal(col, row);
        this.node.setPosition(localPos);
        this._originLocalPos.set(localPos);
    }

    /**
     * 更新物品贴图与等级
     */
    public updateVisual(level: number, spriteFrame?: SpriteFrame | null): void {
        this.level = level;
        if (this._sprite && spriteFrame) {
            this._sprite.spriteFrame = spriteFrame;
        }
    }
}
