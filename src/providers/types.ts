export interface ChutesModel {
  name: string;
  tagline: string;
  hot: boolean;
  invocationCount: number;
}

export interface Provider {
  id: string;
  label: string;
  keyConfigKey: string;
  baseUrl: string;
  fetchModels: () => Promise<ChutesModel[]>;
}
