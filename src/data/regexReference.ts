import { BANK_CARD, BANK_CARD_MASK, EMAIL, EMAIL_MASK, ID_CARD, ID_CARD_MASK, IPV4, IPV4_MASK, PHONE, PHONE_MASK } from './patterns';

/**
 * 正则表达式速查数据。每一行都带有「示例表达式 + 示例文本 + 预期命中」，
 * 由 regexReference.test.ts 用真实匹配引擎逐条验证，保证文档与行为一致。
 */

export interface RegexSyntaxItem {
  /** 语法写法 */
  syntax: string;
  meaning: string;
  /** 示例表达式 */
  example: string;
  /** 示例文本 */
  sample: string;
  /** 示例表达式在示例文本中的预期命中 */
  expect: string[];
}

export interface RegexSyntaxGroup {
  id: string;
  title: string;
  description?: string;
  items: RegexSyntaxItem[];
}

export interface RegexTemplate {
  id: string;
  name: string;
  pattern: string;
  description: string;
  sample: string;
  expect: string[];
  /** 可选的脱敏替换模板，使用模板时一并填入 */
  replacement?: string;
}

const item = (syntax: string, meaning: string, example: string, sample: string, expect: string[]): RegexSyntaxItem => ({
  syntax,
  meaning,
  example,
  sample,
  expect,
});

export const REGEX_SYNTAX: RegexSyntaxGroup[] = [
  {
    id: 'basic',
    title: '基础',
    items: [
      item('.', '任意一个字符（换行除外）', '第.季度', '第一季度、第三季度', ['第一季度', '第三季度']),
      item('\\', '转义：让特殊字符按字面匹配', '3\\.14', '3.14 与 3014', ['3.14']),
      item('a|b', '或：匹配左边或右边', '退款|退货', '申请退款，或者退货', ['退款', '退货']),
    ],
  },
  {
    id: 'class',
    title: '字符类',
    description: '匹配「某一类」字符中的一个',
    items: [
      item('[abc]', '方括号中的任意一个字符', '[微企]信', '微信、企信、短信', ['微信', '企信']),
      item('[^abc]', '不在方括号中的任意一个字符', '第[^一二]名', '第一名、第三名、第五名', ['第三名', '第五名']),
      item('[a-z] [0-9]', '指定范围内的一个字符', '[0-5]号', '3号、7号、5号', ['3号', '5号']),
      item('\\d', '一个数字，等同 [0-9]', '\\d+元', '售价 99元，原价 199元', ['99元', '199元']),
      item('\\D', '一个非数字字符', '订单\\D', '订单A1、订单12', ['订单A']),
      item('\\w', '字母、数字或下划线（不含汉字）', '\\w+', 'user_01 是用户名', ['user_01']),
      item('\\s', '空白：空格、制表符、换行等', '微信\\s*号', '微信号、微信 号', ['微信号', '微信 号']),
      item('\\S', '一个非空白字符', '@\\S+', '联系 @小明 或 @阿花', ['@小明', '@阿花']),
    ],
  },
  {
    id: 'quantifier',
    title: '数量',
    description: '修饰紧挨在前面的一个字符、字符类或分组；默认「贪婪」，尽可能多地匹配',
    items: [
      item('*', '前一项出现 0 次或多次', '0*1', '1、01、0001', ['1', '01', '0001']),
      item('+', '前一项出现 1 次或多次', '哈+', '哈、哈哈哈、呵呵', ['哈', '哈哈哈']),
      item('?', '前一项可有可无（0 或 1 次）', 'https?', 'http 与 https', ['http', 'https']),
      item('{n}', '恰好 n 次', '\\d{4}', '2026年10月', ['2026']),
      item('{n,}', '至少 n 次', '!{2,}', '好! 太好了!!!', ['!!!']),
      item('{n,m}', 'n 到 m 次', '啊{2,3}', '啊、啊啊、啊啊啊啊', ['啊啊', '啊啊啊']),
      item('*? +? ??', '非贪婪：尽可能少地匹配', '【.+?】', '【限时】特价【包邮】', ['【限时】', '【包邮】']),
    ],
  },
  {
    id: 'anchor',
    title: '位置与边界',
    description: '只匹配位置，不占用任何字符',
    items: [
      item('^', '行首', '^\\d+\\.', '1. 第一条\n2. 第二条\n备注 3.', ['1.', '2.']),
      item('$', '行尾', '\\d+$', '订单号 12\n编号 34\n共 5 件', ['12', '34']),
      item('\\b', '单词边界（只对英文字母、数字有效）', '\\bAI\\b', 'AI 与 said', ['AI']),
      item('\\B', '非单词边界', '\\Bai', 'said 与 AI', ['ai']),
    ],
  },
  {
    id: 'group',
    title: '分组与引用',
    items: [
      item('(…)', '分组：把多个字符当作一个整体', '(哈|呵)+', '哈呵哈、嘿', ['哈呵哈']),
      item('(?:…)', '只分组、不捕获（常与 | 搭配）', '(?:微信|QQ)号', '微信号、QQ号、手机号', ['微信号', 'QQ号']),
      item('\\1', '引用第 1 个分组匹配到的内容', '(.)\\1', '哈哈、天天、你好', ['哈哈', '天天']),
    ],
  },
  {
    id: 'lookaround',
    title: '环视',
    description: '检查前后文是否满足条件，条件部分不计入命中（零宽断言）',
    items: [
      item('(?=…)', '后面紧跟着…', '\\d+(?=元)', '100元、200美元、300', ['100']),
      item('(?!…)', '后面不是…', '会员(?!卡)', '会员卡、会员价', ['会员']),
      item('(?<=…)', '前面是…', '(?<=¥)\\d+', '价格¥199，原价$299', ['199']),
      item('(?<!…)', '前面不是…', '(?<!\\d)1[3-9]\\d{9}', '13800138000 与 213800138000', ['13800138000']),
    ],
  },
  {
    id: 'unicode',
    title: 'Unicode',
    description: '按 Unicode 字符属性匹配，本工具会自动启用 Unicode 模式',
    items: [
      item('\\p{Script=Han}', '一个汉字', '\\p{Script=Han}+', 'Hello世界123你好', ['世界', '你好']),
      item('\\p{L} \\p{N}', '任意语言的字母 / 任意数字字符', '\\p{N}+', '第Ⅳ章，共12节', ['Ⅳ', '12']),
      item('\\p{Extended_Pictographic}', 'Emoji 表情符号', '\\p{Extended_Pictographic}+', '好评👍👍 差评😡', ['👍👍', '😡']),
    ],
  },
];

export const REGEX_TEMPLATES: RegexTemplate[] = [
  {
    id: 'phone',
    name: '手机号',
    pattern: PHONE,
    replacement: PHONE_MASK,
    description: '中国大陆 11 位手机号，前后不能紧挨其他数字',
    sample: '电话 13800138000，单号 213800138000',
    expect: ['13800138000'],
  },
  {
    id: 'landline',
    name: '座机号',
    pattern: '(?<!\\d)0\\d{2,3}-\\d{7,8}(?!\\d)',
    description: '区号 + 号码，中间用短横线连接',
    sample: '客服 010-12345678，传真 0755-1234567',
    expect: ['010-12345678', '0755-1234567'],
  },
  {
    id: 'email',
    name: '电子邮箱',
    pattern: EMAIL,
    replacement: EMAIL_MASK,
    description: '常见的邮箱地址格式',
    sample: '请联系 service@example.com',
    expect: ['service@example.com'],
  },
  {
    id: 'id-card',
    name: '身份证号',
    pattern: ID_CARD,
    replacement: ID_CARD_MASK,
    description: '18 位居民身份证号，校验出生年月日范围',
    sample: '证件号 11010519491231002X',
    expect: ['11010519491231002X'],
  },
  {
    id: 'bank-card',
    name: '银行卡号',
    pattern: BANK_CARD,
    replacement: BANK_CARD_MASK,
    description: '16～19 位，允许每 4 位用空格或短横线分隔',
    sample: '卡号 6222 0212 3456 7890',
    expect: ['6222 0212 3456 7890'],
  },
  {
    id: 'url',
    name: '网址',
    pattern: "https?://[\\w\\-.~:/?#\\[\\]@$&+=%]+",
    description: '以 http/https 开头，遇到空白、中文或标点结束',
    sample: '详见 https://example.com/help?id=1，谢谢',
    expect: ['https://example.com/help?id=1'],
  },
  {
    id: 'ipv4',
    name: 'IPv4 地址',
    pattern: IPV4,
    replacement: IPV4_MASK,
    description: '四段 0～255 的数字',
    sample: '服务器 192.168.1.10 已上线',
    expect: ['192.168.1.10'],
  },
  {
    id: 'money',
    name: '金额',
    pattern: '[¥￥$]\\s?\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?|\\d+(?:\\.\\d+)?\\s?(?:元|万元|亿元|美元)',
    description: '货币符号开头，或以「元 / 万元 / 亿元 / 美元」结尾',
    sample: '售价 ￥1,299.00，约合 3.5万元',
    expect: ['￥1,299.00', '3.5万元'],
  },
  {
    id: 'date',
    name: '日期',
    pattern: '\\d{4}[-/.年]\\d{1,2}[-/.月]\\d{1,2}日?',
    description: '2026-10-13、2026/10/13、2026年10月13日 等写法',
    sample: '下单 2026年10月13日，发货 2026-10-15',
    expect: ['2026年10月13日', '2026-10-15'],
  },
  {
    id: 'time',
    name: '时间',
    pattern: '(?<!\\d)(?:[01]?\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?(?!\\d)',
    description: '24 小时制的「时:分」或「时:分:秒」',
    sample: '21:37 提交，08:05:30 处理',
    expect: ['21:37', '08:05:30'],
  },
  {
    id: 'percent',
    name: '百分比',
    pattern: '\\d+(?:\\.\\d+)?%',
    description: '整数或小数百分比',
    sample: '同比增长 30%，环比 12.5%',
    expect: ['30%', '12.5%'],
  },
  {
    id: 'wechat',
    name: '微信号',
    pattern: '(?:微信号?|vx|wx)[:：\\s]*[a-z][-_a-z0-9]{5,19}',
    description: '「微信」等字样后跟 6～20 位微信号（不区分大小写时也能匹配大写）',
    sample: '加微信：yuyanfang_shop 咨询',
    expect: ['微信：yuyanfang_shop'],
  },
  {
    id: 'qq',
    name: 'QQ 号',
    pattern: '(?:QQ|扣扣)[:：\\s]*[1-9]\\d{4,10}',
    description: '「QQ」字样后跟 5～11 位号码',
    sample: 'QQ：12345678',
    expect: ['QQ：12345678'],
  },
  {
    id: 'plate',
    name: '车牌号',
    pattern: '[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-HJ-NP-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]',
    description: '普通车牌与新能源车牌',
    sample: '车牌 粤B12345，新能源 京AD12345',
    expect: ['粤B12345', '京AD12345'],
  },
  {
    id: 'repeat',
    name: '重复字符',
    pattern: '(.)\\1{2,}',
    description: '同一字符连续出现 3 次及以上（叠字、刷屏标点）',
    sample: '哈哈哈 好!!! 嗯嗯',
    expect: ['哈哈哈', '!!!'],
  },
  {
    id: 'superlative',
    name: '「最」字极限词',
    pattern: '最[高低好强大佳优新]',
    description: '「最」后跟程度词的常见绝对化用语',
    sample: '最好的、最低价、最近',
    expect: ['最好', '最低'],
  },
];

/** 使用提示：用反引号包裹的部分会显示为代码 */
export const REGEX_TIPS: string[] = [
  '每行一条，只写表达式本身，不要加 `/…/` 或 `g`、`i` 等标志。',
  '大小写是否敏感由「匹配设置 → 区分大小写」统一控制；已默认开启多行模式，`^`、`$` 匹配每行的行首和行尾。',
  '开启「全半角统一」时，正则作用在已转为半角的文本上：全角数字也能被 `\\d` 匹配，但表达式里的标点请写半角，如 `!` 而非 `！`。',
  '`\\b`、`\\w` 只认英文字母、数字和下划线；中文场景下要「前后不挨着数字」，请用 `(?<!\\d)` 和 `(?!\\d)`。',
  '要按字面匹配这些特殊字符时需加 `\\` 转义：`. * + ? ^ $ { } ( ) [ ] | \\`',
  '默认贪婪匹配，`.+` 可能一直吞到行尾；只想匹配到最近的结束符时用 `.+?`。',
  '能匹配空字符串的部分（如单独的 `x*`）不会产生命中；单条正则最多记录 5000 处命中。',
  '能用普通关键词表达的就不用正则：普通关键词走自动机匹配，速度更快，也更容易维护。',
];

/** 测试区默认文本：覆盖多数常用模板 */
export const REGEX_TEST_TEXT = `订单 2026-10-13 21:37 已发货，客服电话 010-12345678，手机 13800138000。
如有疑问请发邮件至 service@example.com 或访问 https://example.com/help。
本品全网最低价 ￥1,299.00，比上月下降 12.5%，限时抢购!!!`;
