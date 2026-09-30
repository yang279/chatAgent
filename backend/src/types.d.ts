declare module 'pdf-parse' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: any;
    metadata: any;
    text: string;
    version: string;
  }
  function pdfParse(dataBuffer: Buffer, options?: any): Promise<PdfParseResult>;
  export = pdfParse;
}

declare module 'mammoth' {
  interface MammothResult {
    value: string;
    messages: any[];
  }
  export function extractRawText(input: { buffer: Buffer }): Promise<MammothResult>;
}