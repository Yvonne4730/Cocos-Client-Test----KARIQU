import { Vec3 } from 'cc';

/**
 * 棋盘基础配置与几何布局计算
 */
export class BoardConfig {
    /** 棋盘网格列数 (宽 7 列) */
    public static readonly COLS: number = 7;

    /** 棋盘网格行数 (高 9 行) */
    public static readonly ROWS: number = 9;

    /** 单个单元格逻辑尺寸 (像素: 140x140) */
    public static readonly CELL_SIZE: number = 140;

    /** 服装合成链支持的最高等级 */
    public static readonly MAX_LEVEL: number = 12;

    /** 棋盘网格总逻辑宽度 (7 * 140 = 980) */
    public static get TOTAL_WIDTH(): number {
        return this.COLS * this.CELL_SIZE;
    }

    /** 棋盘网格总逻辑高度 (9 * 140 = 1260) */
    public static get TOTAL_HEIGHT(): number {
        return this.ROWS * this.CELL_SIZE;
    }

    /**
     * 将网格坐标 (col, row) 转换为以棋盘中心为原点 (0, 0) 的本地坐标 Vec3
     * 
     * 坐标系约定:
     * col: 0 (最左列) ~ 6 (最右列)
     * row: 0 (最底行) ~ 8 (最顶行)
     * 
     * 计算逻辑:
     * x = (col - (COLS - 1) / 2) * CELL_SIZE
     * y = (row - (ROWS - 1) / 2) * CELL_SIZE
     * 
     * @param col 列索引 (0 ~ COLS - 1)
     * @param row 行索引 (0 ~ ROWS - 1)
     */
    public static gridToLocal(col: number, row: number): Vec3 {
        const x = (col - (this.COLS - 1) / 2) * this.CELL_SIZE;
        const y = (row - (this.ROWS - 1) / 2) * this.CELL_SIZE;
        return new Vec3(x, y, 0);
    }

    /**
     * 将 ItemsContainer 局部坐标 (localX, localY) 转换为网格坐标 (col, row)
     * 
     * 严谨边缘判定逻辑：
     * 1. 棋盘中心为 (0, 0)，X 跨度为 [-TOTAL_WIDTH / 2, TOTAL_WIDTH / 2]
     * 2. Y 跨度为 [-TOTAL_HEIGHT / 2, TOTAL_HEIGHT / 2]
     * 3. 必须先判断落点是否在棋盘外矩形范围内，再做向下取整，杜绝舍入导致的边缘越界误判
     * 
     * @param localX 局部 X 坐标
     * @param localY 局部 Y 坐标
     */
    public static localToGrid(localX: number, localY: number): { col: number; row: number; isValid: boolean } {
        const halfW = this.TOTAL_WIDTH / 2;
        const halfH = this.TOTAL_HEIGHT / 2;

        // 严格范围校验：触点超出棋盘物理矩形边界直接判定无效
        if (localX < -halfW || localX >= halfW || localY < -halfH || localY >= halfH) {
            return { col: -1, row: -1, isValid: false };
        }

        // 以左下角 (-halfW, -halfH) 为基准的原点偏移计算
        const offsetX = localX + halfW;
        const offsetY = localY + halfH;

        const col = Math.floor(offsetX / this.CELL_SIZE);
        const row = Math.floor(offsetY / this.CELL_SIZE);

        if (col >= 0 && col < this.COLS && row >= 0 && row < this.ROWS) {
            return { col, row, isValid: true };
        }

        return { col: -1, row: -1, isValid: false };
    }
}
