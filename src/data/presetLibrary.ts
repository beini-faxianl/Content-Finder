import type { Category, Keyword, KeywordLibrary, Level } from '../core/types';
import {
  BANK_CARD,
  BANK_CARD_MASK,
  EMAIL,
  EMAIL_MASK,
  ID_CARD,
  ID_CARD_MASK,
  IPV4,
  IPV4_MASK,
  PHONE,
  PHONE_MASK,
} from './patterns';

/**
 * 预置词库修订号。修改预置内容时递增，并在 presetUpgrade.ts 中说明如何把改进合并进用户已保存的词库。
 * 注意：关键词 id 由「分类 id + 序号」生成，新增关键词只能追加在列表末尾，不能插入或重排。
 */
export const PRESET_REVISION = 2;

type TermSpec = string | { term: string; note?: string; regex?: boolean; replacement?: string };

function category(
  id: string,
  name: string,
  color: string,
  level: Level,
  description: string,
  terms: TermSpec[],
  exclusions: string[] = [],
): Category {
  const keywords: Keyword[] = terms.map((spec, i) => {
    const { term, note, regex, replacement } = typeof spec === 'string' ? { term: spec } : spec;
    return {
      id: `${id}-${i + 1}`,
      term,
      type: regex ? 'regex' : 'text',
      ...(note ? { note } : {}),
      ...(replacement !== undefined ? { replacement } : {}),
    };
  });
  return { id, name, color, level, description, enabled: true, keywords, exclusions };
}

/** 给一组词附上同一条备注，并按表附上替换建议 */
const withNote = (note: string, terms: string[], replacements: Record<string, string> = {}): TermSpec[] =>
  terms.map((term) => ({ term, note, ...(term in replacements ? { replacement: replacements[term] } : {}) }));

const AD_EXTREME = '极限用语，参见《广告法》第九条，建议删除或改为客观描述';
const AD_MEDICAL = '疾病治疗或功效保证类表述，参见《广告法》第十六、十七条';
const AD_PROFIT = '收益保证类承诺，参见《广告法》第二十五条';
const PII_FIELD = '敏感字段名称，注意其后是否紧跟真实个人信息';

/** 极限用语的替换建议：改为相对、客观的说法（仅供参考，最终措辞需结合事实） */
const AD_REPLACEMENTS: Record<string, string> = {
  最佳: '优质',
  最好: '优质',
  最强: '强劲',
  最高级: '高品质',
  最先进: '先进',
  最便宜: '实惠',
  最低价: '优惠价',
  全网第一: '广受好评',
  销量第一: '热销',
  排名第一: '名列前茅',
  行业第一: '业内知名',
  第一品牌: '知名品牌',
  'NO.1': '热门',
  TOP1: '热门',
  唯一: '独特',
  独一无二: '独具特色',
  首选: '优选',
  顶级: '高端',
  极致: '出众',
  王牌: '招牌',
  史无前例: '少见',
  前所未有: '全新',
  绝对: '非常',
  万能: '多用途',
  永久: '长效',
  无敌: '出色',
  根治: '改善',
};

/** 带否定词的好评，属于负面反馈（版本 2 新增，追加在负面情绪末尾） */
const NEGATED_PRAISE = ['不推荐', '不值得', '不喜欢', '不靠谱', '不专业', '不方便', '不放心', '没耐心', '不满意', '不及时'];

export function createPresetLibrary(): KeywordLibrary {
  return {
    version: 1,
    presetRevision: PRESET_REVISION,
    categories: [
      category('tech', '科技与 AI', '#3b82f6', 'info', '人工智能、半导体、云计算等科技领域术语', [
        '人工智能', 'AI', 'AIGC', '大模型', '大语言模型', 'LLM', '生成式', '机器学习', '深度学习', '神经网络',
        '算法', '算力', '芯片', '半导体', '光刻机', 'GPU', 'CPU', '云计算', '大数据', '数据中心',
        '区块链', '物联网', '5G', '自动驾驶', '机器人', '具身智能', '智能体', 'Agent', '开源', '量子计算',
        '元宇宙', '数字化', '智能化', '操作系统', '智能手机', '新能源汽车', 'Transformer',
      ]),
      category(
        'finance',
        '财经金融',
        '#0d9488',
        'info',
        '资本市场、宏观经济与企业经营相关词汇',
        [
          '金融', '股票', '股价', '股市', 'A股', '港股', '美股', '基金', '债券', '利率',
          '降息', '加息', '通胀', '通货膨胀', 'GDP', 'CPI', '融资', '估值', '上市', 'IPO',
          '营收', '净利润', '毛利率', '市值', '投资', '投资者', '汇率', '人民币', '美元', '央行',
          '银行', '理财', '收益率', '财报', '同比', '环比', '亏损', '盈利', '并购', '风投',
          '天使轮', 'A轮', 'B轮', 'C轮', 'Series B', 'valuation', 'investor', 'investors',
        ],
        ['基金会', '新品上市', '上市新品'],
      ),
      category(
        'health',
        '医疗健康',
        '#8b5cf6',
        'info',
        '疾病、诊疗、药品与健康管理相关词汇',
        [
          '医疗', '医院', '医生', '患者', '疫苗', '药物', '药品', '处方', '处方药', '抗生素',
          '临床试验', '癌症', '肿瘤', '糖尿病', '高血压', '心脏病', '慢性病', '抑郁症', '焦虑症', '失眠',
          '流感', '病毒', '感染', '免疫', '免疫力', '手术', '体检', '睡眠', '营养', '维生素',
          '健康', '心理健康', '治疗', '诊断', '副作用', '医保', '康复',
        ],
        ['感染力', '病毒式', '计算机病毒', '电脑病毒', '故障诊断', '系统诊断'],
      ),
      category(
        'region',
        '地区地名',
        '#d97706',
        'info',
        '国家、城市与经济区域',
        [
          '中国', '北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '西安',
          '重庆', '天津', '苏州', '香港', '澳门', '台湾', '长三角', '珠三角', '粤港澳大湾区', '美国',
          '日本', '韩国', '英国', '法国', '德国', '欧洲', '欧盟', '东南亚', '新加坡', '印度',
          '俄罗斯', '硅谷', 'Singapore',
        ],
        ['印度尼西亚', '印度洋'],
      ),
      category(
        'positive',
        '正面情绪',
        '#16a34a',
        'info',
        '满意、认可、感谢等积极反馈',
        [
          '满意', '喜欢', '推荐', '好评', '感谢', '谢谢', '惊喜', '优秀', '专业', '高效',
          '贴心', '开心', '值得', '点赞', '靠谱', '出色', '不错', '方便', '耐心', '热情',
          '周到', '及时', '放心', '物超所值', 'optimistic',
        ],
        ['推荐算法', '推荐系统', '方便面', ...NEGATED_PRAISE, '不耐心', '不热情', '不周到', '不贴心'],
      ),
      category(
        'negative',
        '负面情绪',
        '#ea580c',
        'warning',
        '投诉、不满、担忧等负面反馈，建议客服或运营关注',
        [
          '失望', '愤怒', '生气', '气愤', '糟糕', '垃圾', '投诉', '退款', '退货', '欺骗',
          '骗子', '差评', '恶心', '无语', '后悔', '坑人', '不满', '质量问题', '态度差', '态度恶劣',
          '拖延', '敷衍', '维权', '太差', '崩溃', '担忧', '担心', '焦虑', '忍无可忍', '曝光',
          '12315', '消协', 'disappointing', 'complained', 'refund', 'refunds',
          ...NEGATED_PRAISE,
        ],
        [
          '不用担心', '无需担心', '不必担心', '别担心', '不会失望', '不后悔', '不坑人', '不再焦虑',
          '垃圾分类', '垃圾桶', '垃圾回收', '曝光度', '曝光补偿', '曝光时间',
        ],
      ),
      category(
        'ad',
        '广告极限用语',
        '#dc2626',
        'danger',
        '《广告法》禁止的绝对化用语，以及功效、收益类违规承诺',
        [
          ...withNote(
            AD_EXTREME,
            [
              '最佳', '最好', '最强', '最高级', '最先进', '最便宜', '最低价', '全网第一', '销量第一', '排名第一',
              '行业第一', '第一品牌', 'NO.1', 'TOP1', '唯一', '独一无二', '独家', '首选', '顶级', '极致',
              '王牌', '国家级', '世界级', '全球领先', '史无前例', '前所未有', '绝对', '100%', '万能', '永久', '无敌',
            ],
            AD_REPLACEMENTS,
          ),
          ...withNote(AD_MEDICAL, ['根治', '包治百病', '药到病除', '立即见效', '立竿见影', '无副作用', '零风险'], AD_REPLACEMENTS),
          ...withNote(AD_PROFIT, ['稳赚不赔', '保本保息', '躺赚', '高回报', '只赚不赔']),
          ...withNote('"特供""专供"等标识存在违规风险', ['特供', '专供']),
        ],
        [
          '最佳实践', '你最好', '最好是', '最好先', '最好不要', '最好还是', '最好别', '首选项',
          '唯一性', '唯一标识', '顶级域名', '绝对值', '绝对路径', '绝对定位', '永久居民', '永久居留',
        ],
      ),
      category(
        'privacy',
        '个人敏感信息',
        '#db2777',
        'danger',
        '手机号、身份证号、邮箱、银行卡号等个人信息，公开发布前请脱敏',
        [
          { term: PHONE, regex: true, note: '疑似手机号码', replacement: PHONE_MASK },
          { term: ID_CARD, regex: true, note: '疑似 18 位身份证号', replacement: ID_CARD_MASK },
          { term: EMAIL, regex: true, note: '电子邮箱地址', replacement: EMAIL_MASK },
          { term: BANK_CARD, regex: true, note: '疑似银行卡号', replacement: BANK_CARD_MASK },
          { term: IPV4, regex: true, note: 'IPv4 地址', replacement: IPV4_MASK },
          ...withNote(PII_FIELD, ['身份证号', '银行卡号', '家庭住址', '密码', '验证码', '微信号']),
        ],
        ['密码学'],
      ),
    ],
  };
}
