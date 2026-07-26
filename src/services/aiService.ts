import { apiFetch, apiJson } from '../lib/api';

export interface AiFormatResponse {
  formattedClassWork?: string | null;
  formattedHomeWork: string;
  summary: string;
  isExam: boolean;
  actionItems: string[];
  isAi: boolean;
}

export const aiService = {
  async formatHomework(text: string, subject?: string): Promise<AiFormatResponse> {
    try {
      const res = await apiFetch('/api/homework/ai-format', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ text, subject }),
      });

      if (!res.ok) {
        throw new Error('AI formatting request failed.');
      }

      const data = await apiJson<AiFormatResponse>(res);
      return data;
    } catch (err) {
      console.error('aiService.formatHomework error:', err);
      // Fallback
      return {
        formattedHomeWork: text,
        summary: 'Homework entry',
        isExam: false,
        actionItems: [],
        isAi: false,
      };
    }
  },
};
