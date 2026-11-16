export type SiteStatus =
  | 'uploading'
  | 'building'
  | 'live'
  | 'runtime_missing'
  | 'stopped'
  | 'error';

export type DeployMode =
  | 'static'
  | 'node_build_static'
  | 'esbuild_react_static'
  | 'node_server'
  | 'python_server'
  | 'java_server'
  | 'php_server'
  | 'go_server'
  | 'files_only';

export interface RuntimeCapabilities {
  node: string | null;
  npm: string | null;
  python3: string | null;
  java: string | null;
  javac: string | null;
  mvn: string | null;
  php: string | null;
  go: string | null;
}

export interface LanguageStat {
  name: string;
  bytes: number;
  percent: number;
  color: string;
}

export interface ProjectDetection {
  language: string;
  framework: string;
  runtime: string;
  mode: DeployMode;
  entryFile: string | null;
  outputDir: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
  fileCount: number;
  totalBytes: number;
  extensions: Record<string, number>;
  languageStats?: LanguageStat[];
}

export interface SiteFileEntry {
  path: string;
  size: number;
  isDirectory: boolean;
}

export interface SiteRecord {
  id: string;
  name: string;
  customDomain: string;
  aliases: string[];
  status: SiteStatus;
  statusMessage: string;
  detection: ProjectDetection;
  port: number | null;
  pid: number | null;
  createdAt: string;
  updatedAt: string;
  lastDeployedAt: string;
  logs: string[];
  sourceRepoUrl?: string;
}

export interface HealthInfo {
  ok: boolean;
  capabilities: RuntimeCapabilities;
  origin: string;
  serverIp: string;
  panelHost: string;
  serverless?: boolean;
}

export interface StarterTemplate {
  id: string;
  title: string;
  language: string;
  description: string;
  defaultDomain: string;
  fileCount: number;
}

export interface DomainVerifyResult {
  domain: string;
  registered: boolean;
  siteId: string | null;
  hostRoutingReady: boolean;
  hostRoutingStatus: number;
  dnsA: string[];
  dnsCname: string[];
  dnsError: string | null;
}
