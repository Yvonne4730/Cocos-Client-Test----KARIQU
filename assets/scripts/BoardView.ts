import { _decorator, Component, Node, UITransform, SpriteFrame, view, Vec3, Layers, input, Input, EventKeyboard, KeyCode } from 'cc';
import { BoardConfig } from './BoardConfig';
import { CellView } from './CellView';
import { ItemView, IItemDragDelegate } from './ItemView';
const { ccclass, property } = _decorator;

/**
 * 棋盘主控制器
 * 负责：
 * 1. 动态生成 7 列 × 9 行（共 63 个）单元格底板节点；
 * 2. 动态生成与管理独立的物品节点层 (ItemsContainer)；
 * 3. 自动适配 Canvas 视口宽高计算居中缩放；
 * 4. 创建并呈现固定测试物品；
 * 5. 实现 IItemDragDelegate 协议，处理移动、同级合成与不同级交换。
 */
@ccclass('BoardView')
export class BoardView extends Component implements IItemDragDelegate {
    @property({
        type: SpriteFrame,
        tooltip: '可选：如果后续提供单格贴图可拖入此处；未指定时自动使用原题配色色块高保真渲染'
    })
    public cellSpriteFrame: SpriteFrame | null = null;

    @property({
        type: [SpriteFrame],
        tooltip: '服装合成链贴图列表 (下标 0 对应等级 1，即 1.png ~ 12.png)'
    })
    public clothesSpriteFrames: SpriteFrame[] = [];

    @property({
        tooltip: '棋盘可用视口占比 (0.85 ~ 0.95)，确保四周留出舒适边距',
        min: 0.5,
        max: 1.0,
        step: 0.05
    })
    public paddingRatio: number = 0.9;

    /** 存放所有 63 个单元格底板引用的二维数组 [col][row] */
    private _cells: CellView[][] = [];

    /** 单元格底板父容器节点（下层） */
    private _cellsContainer: Node | null = null;

    /** 物品父容器节点（上层，与底板完全独立） */
    private _itemsContainer: Node | null = null;

    /** 记录当前棋盘上所有的物品引用 [col][row] */
    private _items: (ItemView | null)[][] = [];

    protected onLoad(): void {
        this._initContainers();
        this._createAllCells();
        this._adaptScreenScale();
        this._spawnTestItems();

        // [DEBUG-START] 临时调试代码：监听键盘按键创建测试物品
        input.on(Input.EventType.KEY_DOWN, this._onDebugKeyDown, this);
        // [DEBUG-END]
    }

    protected onDestroy(): void {
        // [DEBUG-START] 临时调试代码：清理按键监听
        input.off(Input.EventType.KEY_DOWN, this._onDebugKeyDown, this);
        // [DEBUG-END]
    }

    // ==========================================
    // [DEBUG-START] 临时调试入口：测试同级合成
    // ==========================================
    /**
     * 临时调试按键监听：
     * 按键盘空格键 (Space) 或 C 键，在棋盘第一个可用空格生成一个 1 级衣服
     */
    private _onDebugKeyDown(event: EventKeyboard): void {
        if (event.keyCode === KeyCode.SPACE || event.keyCode === KeyCode.KEY_C) {
            this.spawnDebugItemAtFirstEmptyCell(1);
        }
    }

    /**
     * 在棋盘第一个可用空格创建一个指定等级的衣服（默认 1 级）
     * 严格只允许在空格创建，绝不覆盖已有物品
     */
    public spawnDebugItemAtFirstEmptyCell(level: number = 1): ItemView | null {
        for (let col = 0; col < BoardConfig.COLS; col++) {
            for (let row = 0; row < BoardConfig.ROWS; row++) {
                if (this._items[col][row] === null) {
                    console.log(`[Debug] 在空格 (${col}, ${row}) 生成 ${level} 级测试衣服`);
                    return this.createItem('clothes', level, col, row);
                }
            }
        }
        console.warn('[Debug] 棋盘已满，无法生成测试物品');
        return null;
    }
    // ==========================================
    // [DEBUG-END]
    // ==========================================

    /**
     * 创建底格容器与物品容器，确保层级分明：ItemsContainer 永远在 CellsContainer 之上
     */
    private _initContainers(): void {
        const boardLayer = this.node.layer || Layers.Enum.UI_2D;

        // 1. 底板容器
        this._cellsContainer = new Node('CellsContainer');
        this._cellsContainer.layer = boardLayer;
        this._cellsContainer.parent = this.node;
        const cellTrans = this._cellsContainer.addComponent(UITransform);
        cellTrans.setContentSize(BoardConfig.TOTAL_WIDTH, BoardConfig.TOTAL_HEIGHT);

        // 2. 物品容器 (独立于底格，层级在后，渲染在上)
        this._itemsContainer = new Node('ItemsContainer');
        this._itemsContainer.layer = boardLayer;
        this._itemsContainer.parent = this.node;
        const itemTrans = this._itemsContainer.addComponent(UITransform);
        itemTrans.setContentSize(BoardConfig.TOTAL_WIDTH, BoardConfig.TOTAL_HEIGHT);

        // 初始化物品网格引用表
        this._items = [];
        for (let col = 0; col < BoardConfig.COLS; col++) {
            this._items[col] = [];
            for (let row = 0; row < BoardConfig.ROWS; row++) {
                this._items[col][row] = null;
            }
        }
    }

    /**
     * 动态创建 63 个独立单元格底板
     */
    private _createAllCells(): void {
        this._cells = [];
        const container = this._cellsContainer!;

        for (let col = 0; col < BoardConfig.COLS; col++) {
            this._cells[col] = [];
            for (let row = 0; row < BoardConfig.ROWS; row++) {
                const cellNode = new Node(`Cell_${col}_${row}`);
                cellNode.layer = this.node.layer || Layers.Enum.UI_2D;
                cellNode.parent = container;

                const localPos = BoardConfig.gridToLocal(col, row);
                cellNode.setPosition(localPos);

                const cellView = cellNode.addComponent(CellView);
                cellView.init(col, row, this.cellSpriteFrame);

                this._cells[col][row] = cellView;
            }
        }
    }

    /**
     * 创建固定测试物品（分散且不重叠的 5 个不同等级服装）
     */
    private _spawnTestItems(): void {
        const testData = [
            { col: 1, row: 7, level: 1 },  // 左上方：1级
            { col: 5, row: 6, level: 2 },  // 右上方：2级
            { col: 3, row: 4, level: 3 },  // 正中央：3级
            { col: 1, row: 2, level: 4 },  // 左下方：4级
            { col: 5, row: 1, level: 5 },  // 右下方：5级
        ];

        for (const data of testData) {
            this.createItem('clothes', data.level, data.col, data.row);
        }
    }

    /**
     * 在指定格子创建一个物品并绑定拖拽代理
     * 严格检查位置合法性与空格占用，复用单一创建逻辑
     */
    public createItem(type: string, level: number, col: number, row: number): ItemView | null {
        if (col < 0 || col >= BoardConfig.COLS || row < 0 || row >= BoardConfig.ROWS) {
            return null;
        }

        // 绝不覆盖已有物品
        if (this._items[col][row] !== null) {
            return null;
        }

        const itemNode = new Node(`Item_${type}_lv${level}_(${col},${row})`);
        itemNode.layer = this.node.layer || Layers.Enum.UI_2D;
        itemNode.parent = this._itemsContainer;

        const localPos = BoardConfig.gridToLocal(col, row);
        itemNode.setPosition(localPos);

        const spriteFrame = this.clothesSpriteFrames[level - 1] || null;

        const itemView = itemNode.addComponent(ItemView);
        itemView.init(type, level, col, row, spriteFrame);
        itemView.dragDelegate = this;

        this._items[col][row] = itemView;
        return itemView;
    }

    /**
     * 实现 IItemDragDelegate 协议：处理拖拽结束放置校验
     * 规则：
     * 1. 目标位置必须在 7x9 范围内（超出直接返回 false 触发原位回弹）；
     * 2. 若落回原格子，直接对齐返回成功；
     * 3. 拖到空格：正常移动；
     * 4. 拖到同类型且同等级物品（且 < 12 级）：合成为 level + 1 的物品，销毁被拖拽物品，目标物品升级；
     * 5. 拖到不同类型、不同等级或已达最高级 12 的同级物品：交换两个物品的位置。
     */
    public tryMoveItem(item: ItemView, targetCol: number, targetRow: number): boolean {
        // 1. 边界保护
        if (targetCol < 0 || targetCol >= BoardConfig.COLS || targetRow < 0 || targetRow >= BoardConfig.ROWS) {
            return false;
        }

        const oldCol = item.col;
        const oldRow = item.row;

        // 2. 落回原格子：直接对齐居中
        if (oldCol === targetCol && oldRow === targetRow) {
            item.setGridPosition(targetCol, targetRow);
            return true;
        }

        const targetItem = this._items[targetCol][targetRow];

        // 3. 目标格为空：正常移动
        if (targetItem === null) {
            this._items[oldCol][oldRow] = null;
            this._items[targetCol][targetRow] = item;
            item.setGridPosition(targetCol, targetRow);
            return true;
        }

        // 4. 目标格有物品：判断是否满足合成条件（同类型、同等级、且未达最高等级 12）
        const canMerge = item.itemType === targetItem.itemType &&
                         item.level === targetItem.level &&
                         item.level < BoardConfig.MAX_LEVEL;

        if (canMerge) {
            // === 合成逻辑 ===
            const nextLevel = targetItem.level + 1;
            const nextSprite = this.clothesSpriteFrames[nextLevel - 1] || null;

            // 升级目标格物品的数据与贴图
            targetItem.updateVisual(nextLevel, nextSprite);
            targetItem.node.name = `Item_${targetItem.itemType}_lv${nextLevel}_(${targetCol},${targetRow})`;

            // 从原格子引用中清除拖拽物品
            this._items[oldCol][oldRow] = null;

            // 安全销毁被合并的物品节点
            item.node.destroy();

            return true;
        }

        // 5. 交换逻辑：不同类型、不同等级或达到最高级 12 的相同物品 -> 交换位置
        this._items[oldCol][oldRow] = targetItem;
        this._items[targetCol][targetRow] = item;

        targetItem.setGridPosition(oldCol, oldRow);
        item.setGridPosition(targetCol, targetRow);

        return true;
    }

    /**
     * 根据当前 Canvas / View 可用视口自动计算最适合的居中缩放比例
     */
    private _adaptScreenScale(): void {
        const parentTransform = this.node.parent?.getComponent(UITransform);
        let screenW = 1280;
        let screenH = 720;

        if (parentTransform && parentTransform.width > 0 && parentTransform.height > 0) {
            screenW = parentTransform.width;
            screenH = parentTransform.height;
        } else {
            const visibleSize = view.getVisibleSize();
            if (visibleSize.width > 0 && visibleSize.height > 0) {
                screenW = visibleSize.width;
                screenH = visibleSize.height;
            }
        }

        const maxAvailableW = screenW * this.paddingRatio;
        const maxAvailableH = screenH * this.paddingRatio;

        const scaleX = maxAvailableW / BoardConfig.TOTAL_WIDTH;
        const scaleY = maxAvailableH / BoardConfig.TOTAL_HEIGHT;

        const bestScale = Math.min(scaleX, scaleY);
        this.node.setScale(new Vec3(bestScale, bestScale, 1));
    }

    /**
     * 获取指定网格坐标的单元格底板视图
     */
    public getCell(col: number, row: number): CellView | null {
        if (col < 0 || col >= BoardConfig.COLS || row < 0 || row >= BoardConfig.ROWS) {
            return null;
        }
        return this._cells[col]?.[row] || null;
    }

    /**
     * 获取指定网格坐标上的物品视图
     */
    public getItem(col: number, row: number): ItemView | null {
        if (col < 0 || col >= BoardConfig.COLS || row < 0 || row >= BoardConfig.ROWS) {
            return null;
        }
        return this._items[col]?.[row] || null;
    }
}
