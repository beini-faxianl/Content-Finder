import { MOD_KEY } from '../utils/cx';
import { Kbd } from './ui/controls';
import { Modal } from './ui/Modal';

const SHORTCUTS: Array<[keys: string[], description: string]> = [
  [[MOD_KEY, 'E'], '切换编辑 / 阅读模式'],
  [['F3'], '跳到下一处命中'],
  [['Shift', 'F3'], '跳到上一处命中'],
  [['Esc'], '取消聚焦 / 关闭弹窗'],
  [[MOD_KEY, 'K'], '打开关键词库'],
  [[MOD_KEY, 'O'], '导入文本文件'],
  [['?'], '打开本帮助'],
];

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenRegexReference: () => void;
}

export function HelpDialog({ open, onClose, onOpenRegexReference }: HelpDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="使用说明" subtitle="内容发现器 · 按分类发现文本中的关键词">
      <div className="help">
        <section>
          <h3>基本流程</h3>
          <ol>
            <li>在左侧粘贴、输入内容，或把文本文件拖进窗口（支持 UTF-8 与 GBK 编码）。</li>
            <li>命中的关键词按分类着色高亮；右侧给出结论、分类统计、上下文与新词。</li>
            <li>点击高亮或右侧的关键词即可「聚焦」，再用 F3 或导航按钮逐处跳转。</li>
            <li>有替换建议的命中可「按建议修订」：一次处理全部、某个分类或某一处，修订后可撤销。</li>
            <li>需要留档时，从「导出」生成 Markdown / HTML / CSV / JSON 报告。</li>
          </ol>
        </section>
        <section>
          <h3>批量检测</h3>
          <ul>
            <li>点顶栏「批量检测」，粘贴多条文本（每行一条或空行分段），或一次拖入多个文件。</li>
            <li>结果按风险排序，可按结论筛选；点「打开」在编辑器中细看、修订，再从提示中「返回列表」。</li>
            <li>可导出汇总表与命中明细表（CSV），方便分派和留档。</li>
          </ul>
        </section>
        <section>
          <h3>误报与修订</h3>
          <ul>
            <li>
              <b>例外词</b>：命中如果完整落在某个例外词之内就不计入，例如「最佳」之于「最佳实践」、「担心」之于「不用担心」。在阅读模式下划选所在短语，点「设为例外」即可添加。
            </li>
            <li>
              <b>变体写法</b>（默认开启）：「全 网 第 一」「最★低★价」这类插入空格、符号、表情的写法也会命中，悬停可看到还原后的写法；不会跨越换行和句读标点拼词。可在设置中关闭。
            </li>
            <li>
              <b>替换建议</b>：关键词可设置「建议替换为」，例如「最好 → 优质」；正则可引用分组做脱敏，例如手机号
              <code>$1****$2</code> 得到 138****8000。
            </li>
            <li>「命中上下文」可按风险 / 关注 / 提示筛选，逐条查看违规原因与建议，适合作为审核清单。</li>
          </ul>
        </section>
        <section>
          <h3>两种视图</h3>
          <ul>
            <li>
              <b>编辑模式</b>：边输入边高亮，适合修改文案、即时验证改写效果。
            </li>
            <li>
              <b>阅读模式</b>：悬停高亮查看分类、级别、备注；划选文字可直接加入词库。
            </li>
          </ul>
        </section>
        <section>
          <h3>代码与报文</h3>
          <ul>
            <li>
              <b>代码视图</b>（工具栏上的 <code>&lt;&gt;</code>）：等宽字体、不自动换行、显示行号，适合代码、日志与 HTTP 报文。
            </li>
            <li>
              <b>先解码再匹配</b>（默认开启）：URL 编码、<code>\u</code> 转义、HTML 实体会先还原再匹配，高亮仍落在原文上，悬停可看到解码结果。
            </li>
            <li>导入 .har 文件会自动转换为原始 HTTP 报文；HTML 文件可在设置中选择「提取正文」或「保留源码」。</li>
            <li>每个分类可在关键词库中单独设置整词匹配与大小写，例如让代码类关键词 password 也能命中 db_password。</li>
          </ul>
        </section>
        <section>
          <h3>高亮样式</h3>
          <ul>
            <li>底色与下划线颜色 = 分类颜色；斜纹表示同一处同时属于多个分类。</li>
            <li>点击下方图例可隐藏 / 显示某个分类，Alt+点击或双击则只看该分类。</li>
            <li>文本右侧的缩略条展示命中在全文中的分布，点击即可跳转。</li>
          </ul>
        </section>
        <section>
          <h3>关键词库</h3>
          <ul>
            <li>每个分类可设置颜色、级别（提示 / 关注 / 风险）与说明，关键词可附备注。</li>
            <li>
              关键词支持普通文本与正则表达式（JavaScript 语法），例如 <code>1[3-9]\d{'{9}'}</code> 匹配手机号。
              <button type="button" className="link-btn" onClick={onOpenRegexReference}>
                查看正则语法速查表
              </button>
            </li>
            <li>词库可导入 / 导出为 JSON 或 CSV（列：分类, 关键词, 类型, 备注, 替换为），方便团队共享。</li>
            <li>分析在后台线程中进行：写错的正则即使陷入「灾难性回溯」也不会卡住页面，超时的规则会被自动暂停。</li>
            <li>所有数据仅保存在本机浏览器中，不会上传到任何服务器；多个标签页之间自动同步。</li>
          </ul>
        </section>
        <section>
          <h3>快捷键</h3>
          <table className="shortcut-table">
            <tbody>
              {SHORTCUTS.map(([keys, description]) => (
                <tr key={description}>
                  <td>
                    {keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && ' + '}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </td>
                  <td>{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </Modal>
  );
}
