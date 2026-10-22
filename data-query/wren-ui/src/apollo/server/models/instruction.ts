export interface InstructionInput {
  projectId: number;
  instruction: string;
  questions: string[];
  isDefault: boolean;
  // DD-133 §3: creating Kailo user.
  ownerKey?: string | null;
}

export interface UpdateInstructionInput {
  id: number;
  projectId: number;
  instruction: string;
  questions: string[];
  isDefault: boolean;
}
