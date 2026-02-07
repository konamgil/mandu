/**
 * DNA-001: Plugin Registry
 *
 * 플러그인 등록 및 관리
 * - 중복 등록 방지
 * - 의존성 해결
 * - 라이프사이클 관리
 */

import type {
  Plugin,
  PluginApi,
  PluginCategory,
  PluginMeta,
  GuardPresetPlugin,
  BuildPlugin,
  LoggerTransportPlugin,
  McpToolPlugin,
  MiddlewarePlugin,
} from "./types";

/**
 * 플러그인 등록 상태
 */
type PluginState = "pending" | "loaded" | "error" | "unloaded";

/**
 * 등록된 플러그인 정보
 */
interface RegisteredPlugin<TConfig = unknown> {
  plugin: Plugin<TConfig>;
  state: PluginState;
  config?: TConfig;
  error?: Error;
  loadedAt?: Date;
}

/**
 * 소유자 정보 포함 리소스
 */
interface OwnedResource<T> {
  owner: string;
  value: T;
}

/**
 * 플러그인 레지스트리
 */
export class PluginRegistry {
  private plugins = new Map<string, RegisteredPlugin>();
  private guardPresets = new Map<string, OwnedResource<GuardPresetPlugin>>();
  private buildPlugins = new Map<string, OwnedResource<BuildPlugin>>();
  private loggerTransports = new Map<string, OwnedResource<LoggerTransportPlugin>>();
  private mcpTools = new Map<string, OwnedResource<McpToolPlugin>>();
  private middlewares = new Map<string, OwnedResource<MiddlewarePlugin>>();

  private logger = {
    debug: (msg: string, data?: unknown) =>
      console.debug(`[Plugin] ${msg}`, data ?? ""),
    info: (msg: string, data?: unknown) =>
      console.info(`[Plugin] ${msg}`, data ?? ""),
    warn: (msg: string, data?: unknown) =>
      console.warn(`[Plugin] ${msg}`, data ?? ""),
    error: (msg: string, data?: unknown) =>
      console.error(`[Plugin] ${msg}`, data ?? ""),
  };

  private configStore = new Map<string, unknown>();

  /**
   * 플러그인 등록
   */
  async register<TConfig>(
    plugin: Plugin<TConfig>,
    config?: TConfig
  ): Promise<void> {
    const { id } = plugin.meta;

    // 중복 체크
    if (this.plugins.has(id)) {
      throw new Error(`Plugin "${id}" is already registered`);
    }

    // 설정 검증
    let validatedConfig = config;
    if (plugin.configSchema) {
      const result = plugin.configSchema.safeParse(config);
      if (!result.success) {
        const error = new Error(
          `Invalid config for plugin "${id}": ${result.error.message}`
        );
        this.plugins.set(id, { plugin, state: "error", error });
        throw error;
      }
      validatedConfig = result.data;
    }

    // 등록
    this.plugins.set(id, {
      plugin,
      state: "pending",
      config: validatedConfig,
    });

    // 로드
    try {
      const api = this.createPluginApi(id);
      await plugin.register(api, validatedConfig as TConfig);

      // onLoad 훅
      if (plugin.onLoad) {
        await plugin.onLoad();
      }

      const entry = this.plugins.get(id)!;
      entry.state = "loaded";
      entry.loadedAt = new Date();

      this.logger.info(`Plugin loaded: ${id} (v${plugin.meta.version})`);
    } catch (error) {
      const entry = this.plugins.get(id)!;
      entry.state = "error";
      entry.error = error instanceof Error ? error : new Error(String(error));
      throw entry.error;
    }
  }

  /**
   * 플러그인 언로드
   */
  async unregister(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) {
      throw new Error(`Plugin "${id}" is not registered`);
    }

    // onUnload 훅
    if (entry.plugin.onUnload) {
      await entry.plugin.onUnload();
    }

    // 등록된 리소스 정리
    this.removeOwnedResources(id);

    entry.state = "unloaded";
    this.plugins.delete(id);

    this.logger.info(`Plugin unloaded: ${id}`);
  }

  /**
   * 플러그인 조회
   */
  get(id: string): RegisteredPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * 모든 플러그인 목록
   */
  getAll(): RegisteredPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 카테고리별 플러그인 조회
   */
  getByCategory(category: PluginCategory): RegisteredPlugin[] {
    return this.getAll().filter((p) => p.plugin.meta.category === category);
  }

  /**
   * Guard 프리셋 조회
   */
  getGuardPreset(id: string): GuardPresetPlugin | undefined {
    return this.guardPresets.get(id)?.value;
  }

  /**
   * 모든 Guard 프리셋 목록
   */
  getAllGuardPresets(): GuardPresetPlugin[] {
    return Array.from(this.guardPresets.values()).map((entry) => entry.value);
  }

  /**
   * 빌드 플러그인 조회
   */
  getBuildPlugin(id: string): BuildPlugin | undefined {
    return this.buildPlugins.get(id)?.value;
  }

  /**
   * 모든 빌드 플러그인 목록
   */
  getAllBuildPlugins(): BuildPlugin[] {
    return Array.from(this.buildPlugins.values()).map((entry) => entry.value);
  }

  /**
   * 로거 전송 조회
   */
  getLoggerTransport(id: string): LoggerTransportPlugin | undefined {
    return this.loggerTransports.get(id)?.value;
  }

  /**
   * 모든 로거 전송 목록
   */
  getAllLoggerTransports(): LoggerTransportPlugin[] {
    return Array.from(this.loggerTransports.values()).map((entry) => entry.value);
  }

  /**
   * MCP 도구 조회
   */
  getMcpTool(name: string): McpToolPlugin | undefined {
    return this.mcpTools.get(name)?.value;
  }

  /**
   * 모든 MCP 도구 목록
   */
  getAllMcpTools(): McpToolPlugin[] {
    return Array.from(this.mcpTools.values()).map((entry) => entry.value);
  }

  /**
   * 미들웨어 조회 (순서대로)
   */
  getAllMiddlewares(): MiddlewarePlugin[] {
    return Array.from(this.middlewares.values())
      .map((entry) => entry.value)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  /**
   * 설정 저장
   */
  setConfig<T>(key: string, value: T): void {
    this.configStore.set(key, value);
  }

  /**
   * 설정 조회
   */
  getConfig<T>(key: string): T | undefined {
    return this.configStore.get(key) as T | undefined;
  }

  /**
   * 서버 시작 훅 실행
   */
  async onServerStart(): Promise<void> {
    for (const [id, entry] of this.plugins) {
      if (entry.state === "loaded" && entry.plugin.onServerStart) {
        try {
          await entry.plugin.onServerStart();
        } catch (error) {
          this.logger.error(`onServerStart failed for plugin "${id}"`, error);
        }
      }
    }
  }

  /**
   * 서버 종료 훅 실행
   */
  async onServerStop(): Promise<void> {
    for (const [id, entry] of this.plugins) {
      if (entry.state === "loaded" && entry.plugin.onServerStop) {
        try {
          await entry.plugin.onServerStop();
        } catch (error) {
          this.logger.error(`onServerStop failed for plugin "${id}"`, error);
        }
      }
    }
  }

  /**
   * 플러그인 API 생성
   */
  private createPluginApi(ownerId: string): PluginApi {
    return {
      registerGuardPreset: (preset) => {
        if (this.guardPresets.has(preset.id)) {
          throw new Error(`Guard preset "${preset.id}" is already registered`);
        }
        this.guardPresets.set(preset.id, { owner: ownerId, value: preset });
        this.logger.debug(`Registered guard preset: ${preset.id}`);
      },

      registerBuildPlugin: (plugin) => {
        if (this.buildPlugins.has(plugin.id)) {
          throw new Error(`Build plugin "${plugin.id}" is already registered`);
        }
        this.buildPlugins.set(plugin.id, { owner: ownerId, value: plugin });
        this.logger.debug(`Registered build plugin: ${plugin.id}`);
      },

      registerLoggerTransport: (transport) => {
        if (this.loggerTransports.has(transport.id)) {
          throw new Error(
            `Logger transport "${transport.id}" is already registered`
          );
        }
        this.loggerTransports.set(transport.id, { owner: ownerId, value: transport });
        this.logger.debug(`Registered logger transport: ${transport.id}`);
      },

      registerMcpTool: (tool) => {
        if (this.mcpTools.has(tool.name)) {
          throw new Error(`MCP tool "${tool.name}" is already registered`);
        }
        this.mcpTools.set(tool.name, { owner: ownerId, value: tool });
        this.logger.debug(`Registered MCP tool: ${tool.name}`);
      },

      registerMiddleware: (middleware) => {
        if (this.middlewares.has(middleware.id)) {
          throw new Error(
            `Middleware "${middleware.id}" is already registered`
          );
        }
        this.middlewares.set(middleware.id, { owner: ownerId, value: middleware });
        this.logger.debug(`Registered middleware: ${middleware.id}`);
      },

      getConfig: <T>(key: string) => this.getConfig<T>(key),

      logger: this.logger,
    };
  }

  private removeOwnedResources(ownerId: string): void {
    const removeOwned = <T>(map: Map<string, OwnedResource<T>>): void => {
      for (const [id, entry] of map.entries()) {
        if (entry.owner === ownerId) {
          map.delete(id);
        }
      }
    };

    removeOwned(this.guardPresets);
    removeOwned(this.buildPlugins);
    removeOwned(this.loggerTransports);
    removeOwned(this.mcpTools);
    removeOwned(this.middlewares);
  }

  /**
   * 레지스트리 초기화
   */
  async reset(): Promise<void> {
    // 모든 플러그인 언로드
    for (const id of this.plugins.keys()) {
      await this.unregister(id);
    }

    this.configStore.clear();
  }
}

/**
 * 전역 플러그인 레지스트리
 */
export const globalPluginRegistry = new PluginRegistry();

/**
 * 플러그인 정의 헬퍼
 */
export function definePlugin<TConfig = void>(
  plugin: Plugin<TConfig>
): Plugin<TConfig> {
  return plugin;
}
