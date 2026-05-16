export type Address = number[];

export interface LexicalNode {
  type: string;
  version?: number;
  [key: string]: unknown;
}

export interface LexicalElementNode extends LexicalNode {
  children: LexicalNode[];
  direction?: string | null;
  format?: string | number;
  indent?: number;
}

export interface LexicalTextNode extends LexicalNode {
  type: "text";
  text: string;
  format?: number;
  detail?: number;
  mode?: string;
  style?: string;
}

export interface LexicalRoot {
  type: "root";
  children: LexicalNode[];
  direction?: string | null;
  format?: string | number;
  indent?: number;
  version?: number;
}
