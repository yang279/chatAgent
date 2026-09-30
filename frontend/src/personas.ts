export interface Persona {
  id: string;
  label: string;
  text: string;
}

export const PERSONAS: Persona[] = [
  {
    id: 'default',
    label: '默认助手',
    text: '',
  },
  {
    id: 'scholar',
    label: '专业学者',
    text: '你是一位严谨专业的领域专家。回答结构清晰、逻辑严密，措辞正式规范，优先引用知识库来源并准确标注，不轻易下结论。',
  },
  {
    id: 'funny',
    label: '幽默伙伴',
    text: '你是一个幽默风趣、轻松健谈的伙伴。回答口语化、接地气，可以适当开玩笑、使用生活化比喻，但必须保证信息准确，不为搞笑而误导。',
  },
];