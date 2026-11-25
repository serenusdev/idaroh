export interface DocumentationFields {
  accessSetup?: string | null;
  howToUse?: string | null;
  workflowExamples?: string | null;
  limitationsCautions?: string | null;
  officialSources?: string | null;
  documentationStatus?: string | null;
}

export interface ResourceItem extends DocumentationFields {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  categorySlug: string;
  officialUrl?: string | null;
  tags: string[];
  isFavorited?: boolean;
  filledFieldsCount: number;
  totalFieldsCount: number;
  lastUpdated: string;
  author: string;
  visibility: "internal" | "restricted";
  status: "draft" | "published" | "archived";
}

export interface CategorySummary {
  name: string;
  slug: string;
  count: number;
  icon?: string;
}

export interface ResourceAdminInput extends DocumentationFields {
  legacyRecordId?: string | null;
  name: string;
  slug: string;
  description: string;
  categoryId?: string | null;
  officialUrl?: string | null;
  visibility: "internal" | "restricted";
  status: "draft" | "published" | "archived";
  tags: string[];
}

export interface ResourceRevisionItem {
  id: string;
  revisionNo: number;
  snapshot: ResourceAdminInput;
  changeNote?: string | null;
  changedAt: string;
  changedBy?: string | null;
}

export interface ResourceVisibilityRules {
  roleKeys: string[];
  teamIds: string[];
}

export interface ResourceRuleOptions {
  roles: Array<{ key: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
}

