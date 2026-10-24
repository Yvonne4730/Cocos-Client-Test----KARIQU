import { _decorator, Component, Node, UITransform, SpriteFrame, view, Vec3, Layers, sys } from 'cc';
import { BoardConfig } from './BoardConfig';
import { CellView } from './CellView';
import { ItemView, IItemDragDelegate } from './ItemView';
import { GeneratorView, IGeneratorDelegate } from './GeneratorView';
const { ccclass, property } = _decorator;

interface SavedItem {
    type: string;
    level: number;
    col: number;
    row: number;
}

interface BoardSave {
    version: number;
    items: SavedItem[];
}

/**
 * 棋盘主控制器
 * 负责：
 * 1. 动态生成 7 列 × 9 行（共 63 个）单元格底板节点；
 * 2. 动态生成与管理独立的物品节点层 (ItemsContainer)；
 * 3. 动态生成并管理固定生成器 (GeneratorView)；
 * 4. 自动适配 Canvas 视口宽高计算居中缩放；
 * 5. 创建并呈现固定测试物品；
 * 6. 实现拖拽校验、同级合成与不同级交换；
 * 7. 响应生成器点击产出物品。
 */
@ccclass('BoardView')
export class BoardView extends Component implements IItemDragDelegate, IGeneratorDelegate {
    private static readonly SAVE_KEY = 'merge_board_save_v1';
    private static readonly SAVE_VERSION = 1;

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
        type: SpriteFrame,
        tooltip: '生成器贴图 (assets/Art/generator/1.png)'
    })
    public generatorSpriteFrame: SpriteFrame | null = null;

    @property({
        tooltip: '棋盘可用视口占比 (0.85 ~ 0.95)，确保四周留出舒适边距',
        min: 0.5,
        max: 1.0,
        step: 0.05
    })
    public paddingRatio: number = 0.9;

    /** 存放所有 63 个单元格底板引用的二维数组 [col][row] */
    private _cells: CellView[][] = [];

    /** 单元格底板父容器节点（底层） */
    private _cellsContainer: Node | null = null;

    /** 物品父容器节点（顶层，与底板完全独立） */
    private _itemsContainer: Node | null = null;

    /** 记录当前棋盘上所有的普通物品引用 [col][row] */
    private _items: (ItemView | null)[][] = [];

    /** 固定生成器实例引用（独立管理，不存入 _items 数组） */
    private _generator: GeneratorView | null = null;

    /** 固定生成器的网格坐标配置 (选择 (0, 8) 左上角黄金固定位，避开现有 5 个测试物品) */
    public static readonly GENERATOR_POS = { col: 0, row: 8 };

    protected onLoad(): void {
        this._initContainers();
        this._createAllCells();
        this._adaptScreenScale();
        this._createGenerator();

        const savedItems = this._loadSave();
        if (savedItems && this._restoreItems(savedItems)) {
            return;
        }

        this._spawnTestItems();
        this._saveBoardState();
    }

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

        // 2. 物品与生成器容器 (独立于底格，层级在后，渲染在上)
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
     * 创建固定生成器：
     * 1. 独立于 _items 数组管理，不参与物品数组更新；
     * 2. 挂载在 ItemsContainer 中并绑定点击委托；
     * 3. 坐标固定于 (0, 8)，不被拖拽移动。
     */
    private _createGenerator(): void {
        const { col, row } = BoardView.GENERATOR_POS;
        const genNode = new Node(`Generator_(${col},${row})`);
        genNode.layer = this.node.layer || Layers.Enum.UI_2D;
        genNode.parent = this._itemsContainer;

        const genView = genNode.addComponent(GeneratorView);
        genView.init(col, row, this.generatorSpriteFrame);
        genView.delegate = this;

        this._generator = genView;
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

    /** 读取并校验本地存档；无存档、损坏或不支持的数据返回 null。 */
    private _loadSave(): SavedItem[] | null {
        try {
            const raw = sys.localStorage.getItem(BoardView.SAVE_KEY);
            if (!raw) {
                return null;
            }

            const parsed: unknown = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }

            const save = parsed as Partial<BoardSave>;
            if (save.version !== BoardView.SAVE_VERSION || !Array.isArray(save.items)) {
                return null;
            }

            const occupied = new Set<string>();
            const generator = BoardView.GENERATOR_POS;
            for (const item of save.items) {
                if (!item || typeof item !== 'object' || item.type !== 'clothes') {
                    return null;
                }
                if (!Number.isInteger(item.level) || item.level < 1 || item.level > BoardConfig.MAX_LEVEL) {
                    return null;
                }
                if (!Number.isInteger(item.col) || item.col < 0 || item.col >= BoardConfig.COLS ||
                    !Number.isInteger(item.row) || item.row < 0 || item.row >= BoardConfig.ROWS) {
                    return null;
                }
                if (item.col === generator.col && item.row === generator.row) {
                    return null;
                }

                const position = `${item.col},${item.row}`;
                if (occupied.has(position)) {
                    return null;
                }
                occupied.add(position);
            }

            return save.items as SavedItem[];
        } catch (error) {
            console.warn('[MergeBoard] 读取本地存档失败，将使用初始棋盘。', error);
            return null;
        }
    }

    /** 按已校验的数据恢复物品；创建异常时清除部分恢复结果并回退。 */
    private _restoreItems(items: SavedItem[]): boolean {
        try {
            for (const data of items) {
                if (!this.createItem(data.type, data.level, data.col, data.row)) {
                    console.warn('[MergeBoard] 恢复存档时创建物品失败，将使用默认棋盘。');
                    this._clearRestoredItems();
                    return false;
                }
            }
            return true;
        } catch (error) {
            console.warn('[MergeBoard] 恢复存档时创建物品发生异常，将使用默认棋盘。', error);
            this._clearRestoredItems();
            return false;
        }
    }

    /** 只清理普通物品节点并重建空网格引用，保留独立管理的生成器。 */
    private _clearRestoredItems(): void {
        try {
            const container = this._itemsContainer;
            if (container) {
                for (const child of [...container.children]) {
                    try {
                        if (child === this._generator?.node) {
                            continue;
                        }

                        // createItem 先将 Item_* 节点挂入容器，再添加组件并登记到 _items。
                        // 同时按组件识别物品，覆盖创建中途节点名称变化的情况。
                        const isItemNode = child.name.startsWith('Item_') || child.getComponent(ItemView);
                        if (isItemNode && !child.getComponent(GeneratorView)) {
                            child.active = false;
                            child.destroy();
                        }
                    } catch (error) {
                        console.warn(`[MergeBoard] 清理恢复物品节点失败：${child.name}`, error);
                    }
                }
            }
        } catch (error) {
            console.warn('[MergeBoard] 清理恢复物品时发生异常。', error);
        } finally {
            this._items = [];
            for (let col = 0; col < BoardConfig.COLS; col++) {
                this._items[col] = [];
                for (let row = 0; row < BoardConfig.ROWS; row++) {
                    this._items[col][row] = null;
                }
            }
        }
    }

    /** 保存当前普通物品列表，不保存固定生成器的固定坐标。 */
    private _saveBoardState(): void {
        const items: SavedItem[] = [];
        for (let col = 0; col < BoardConfig.COLS; col++) {
            for (let row = 0; row < BoardConfig.ROWS; row++) {
                const item = this._items[col][row];
                if (item) {
                    items.push({
                        type: item.itemType,
                        level: item.level,
                        col: item.col,
                        row: item.row,
                    });
                }
            }
        }

        const save: BoardSave = { version: BoardView.SAVE_VERSION, items };
        try {
            sys.localStorage.setItem(BoardView.SAVE_KEY, JSON.stringify(save));
        } catch (error) {
            console.warn('[MergeBoard] 保存本地棋盘状态失败。', error);
        }
    }

    /**
     * 实现 IGeneratorDelegate：响应生成器点击
     */
    public onGeneratorClicked(generator: GeneratorView): void {
        const emptyCell = this.findFirstEmptyCell();
        if (!emptyCell) {
            console.warn('[MergeBoard] 棋盘已满，无法生成新物品！');
            return;
        }

        console.log(`[MergeBoard] 生成器点击：在空格 (${emptyCell.col}, ${emptyCell.row}) 产出 1 级衣服`);
        if (this.createItem('clothes', 1, emptyCell.col, emptyCell.row)) {
            this._saveBoardState();
        }
    }

    /**
     * 查找棋盘中的第一个真正空格：
     * 排除已有物品的格子，并且排除生成器占用的固定格子！
     */
    public findFirstEmptyCell(): { col: number; row: number } | null {
        const genPos = BoardView.GENERATOR_POS;
        for (let col = 0; col < BoardConfig.COLS; col++) {
            for (let row = 0; row < BoardConfig.ROWS; row++) {
                // 如果是生成器所在格子，跳过
                if (col === genPos.col && row === genPos.row) {
                    continue;
                }
                // 如果没有普通物品占用，即为有效空格
                if (this._items[col][row] === null) {
                    return { col, row };
                }
            }
        }
        return null;
    }

    /**
     * 在指定格子创建一个普通物品并绑定拖拽代理
     * 严格检查位置合法性与占用情况，绝不覆盖已有物品或生成器
     */
    public createItem(type: string, level: number, col: number, row: number): ItemView | null {
        if (col < 0 || col >= BoardConfig.COLS || row < 0 || row >= BoardConfig.ROWS) {
            return null;
        }

        // 不能在生成器所在格子上创建普通物品
        if (col === BoardView.GENERATOR_POS.col && row === BoardView.GENERATOR_POS.row) {
            return null;
        }

        // 绝不覆盖已有普通物品
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
     * 实现 IItemDragDelegate 协议：处理普通物品拖拽放置校验
     * 规则：
     * 1. 目标位置必须在 7x9 范围内（超出直接返回 false 触发原位回弹）；
     * 2. 若目标格为生成器所在位置：生成器不可交互、不可合成或交换，直接回弹；
     * 3. 若落回原格子，直接对齐返回成功；
     * 4. 拖到空格：正常移动；
     * 5. 拖到同类型且同等级普通物品（且 < 12 级）：合成为 level + 1 的物品，销毁被拖拽物品，目标物品升级；
     * 6. 拖到不同类型、不同等级或已达最高级 12 的同级物品：交换两个物品的位置。
     */
    public tryMoveItem(item: ItemView, targetCol: number, targetRow: number): boolean {
        // 1. 边界保护
        if (targetCol < 0 || targetCol >= BoardConfig.COLS || targetRow < 0 || targetRow >= BoardConfig.ROWS) {
            return false;
        }

        // 2. 生成器固定位保护：禁止将物品拖到生成器格子上（不参与交换或合成）
        if (targetCol === BoardView.GENERATOR_POS.col && targetRow === BoardView.GENERATOR_POS.row) {
            return false;
        }

        const oldCol = item.col;
        const oldRow = item.row;

        // 3. 落回原格子：直接对齐居中
        if (oldCol === targetCol && oldRow === targetRow) {
            item.setGridPosition(targetCol, targetRow);
            return true;
        }

        const targetItem = this._items[targetCol][targetRow];

        // 4. 目标格为空：正常移动
        if (targetItem === null) {
            this._items[oldCol][oldRow] = null;
            this._items[targetCol][targetRow] = item;
            item.setGridPosition(targetCol, targetRow);
            this._saveBoardState();
            return true;
        }

        // 5. 目标格有普通物品：判断是否满足合成条件（同类型、同等级、且未达最高等级 12）
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

            this._saveBoardState();

            return true;
        }

        // 6. 交换逻辑：不同类型、不同等级或达到最高级 12 的相同物品 -> 交换位置
        this._items[oldCol][oldRow] = targetItem;
        this._items[targetCol][targetRow] = item;

        targetItem.setGridPosition(oldCol, oldRow);
        item.setGridPosition(targetCol, targetRow);

        this._saveBoardState();

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

    /**
     * 获取固定生成器视图
     */
    public getGenerator(): GeneratorView | null {
        return this._generator;
    }
}
