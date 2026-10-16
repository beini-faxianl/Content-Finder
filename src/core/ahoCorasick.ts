/**
 * Aho-Corasick 多模式字符串匹配自动机。
 *
 * 构建复杂度 O(Σ|pattern|)，查找复杂度 O(|text| + 命中数)，与关键词数量无关，
 * 因此即便词库有上万个关键词，也能在毫秒级完成长文本扫描。
 * 以 UTF-16 码元为字母表，与 JS 字符串下标保持一致。
 */
export class AhoCorasick {
  private readonly next: Array<Map<number, number>> = [new Map()];
  private readonly fail: number[] = [0];
  /** 以该节点结尾的模式下标 */
  private readonly output: number[][] = [[]];
  /** 沿失配链最近的、output 非空的节点；-1 表示没有 */
  private readonly outputLink: number[] = [-1];
  private readonly lengths: number[];

  constructor(patterns: readonly string[]) {
    this.lengths = patterns.map((p) => p.length);
    patterns.forEach((pattern, index) => this.insert(pattern, index));
    this.buildFailureLinks();
  }

  get size(): number {
    return this.lengths.length;
  }

  /** 扫描文本，每找到一个模式就回调一次（同一位置可能回调多次） */
  search(text: string, onMatch: (start: number, end: number, pattern: number) => void): void {
    let node = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      while (node !== 0 && !this.next[node].has(code)) node = this.fail[node];
      node = this.next[node].get(code) ?? 0;

      let out = this.output[node].length > 0 ? node : this.outputLink[node];
      while (out > 0) {
        for (const pattern of this.output[out]) {
          const end = i + 1;
          onMatch(end - this.lengths[pattern], end, pattern);
        }
        out = this.outputLink[out];
      }
    }
  }

  private insert(pattern: string, index: number): void {
    if (pattern.length === 0) return;
    let node = 0;
    for (let i = 0; i < pattern.length; i++) {
      const code = pattern.charCodeAt(i);
      let child = this.next[node].get(code);
      if (child === undefined) {
        child = this.next.length;
        this.next.push(new Map());
        this.fail.push(0);
        this.output.push([]);
        this.outputLink.push(-1);
        this.next[node].set(code, child);
      }
      node = child;
    }
    this.output[node].push(index);
  }

  private buildFailureLinks(): void {
    const queue: number[] = [...this.next[0].values()];
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head];
      for (const [code, child] of this.next[node]) {
        let f = this.fail[node];
        while (f !== 0 && !this.next[f].has(code)) f = this.fail[f];
        const target = this.next[f].get(code);
        const failTo = target !== undefined && target !== child ? target : 0;
        this.fail[child] = failTo;
        this.outputLink[child] = this.output[failTo].length > 0 ? failTo : this.outputLink[failTo];
        queue.push(child);
      }
    }
  }
}
