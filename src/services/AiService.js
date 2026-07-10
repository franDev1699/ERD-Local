// src/services/AiService.js

export class AiService {
  static CONFIG_KEY = 'erd_ai_config';

  static getDefaultConfig() {
    return {
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      apiKey: '',
      apiUrl: 'http://localhost:11434',
      enableThinking: false
    };
  }

  static loadConfig() {
    try {
      const stored = localStorage.getItem(this.CONFIG_KEY);
      if (stored) {
        return { ...this.getDefaultConfig(), ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error('Error al cargar configuración de IA:', e);
    }
    return this.getDefaultConfig();
  }

  static async fetchConfigFromServer() {
    try {
      const response = await fetch('/api/ai/config');
      if (response.ok) {
        const config = await response.json();
        localStorage.setItem(this.CONFIG_KEY, JSON.stringify(config));
        return config;
      }
    } catch (e) {
      console.error('Error al cargar config de IA desde servidor:', e);
    }
    return this.loadConfig();
  }

  static async saveConfig(config) {
    try {
      // 1. Guardar en el servidor de forma segura
      const response = await fetch('/api/ai/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      // 2. Enmascarar la clave en localStorage localmente para no exponerla en el navegador
      const maskedConfig = {
        ...config,
        apiKey: config.apiKey ? '••••••••' : ''
      };
      localStorage.setItem(this.CONFIG_KEY, JSON.stringify(maskedConfig));
      return true;
    } catch (e) {
      console.error('Error al guardar configuración de IA:', e);
      throw e;
    }
  }

  static async generate(prompt, currentState = null, mode = 'replace', extraParams = {}) {
    const config = this.loadConfig();
    
    const payload = {
      provider: config.provider,
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      model: config.model,
      enableThinking: !!config.enableThinking,
      prompt: prompt,
      currentState: currentState,
      mode: mode,
      ...extraParams
    };

    const response = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }

  static async document(currentState) {
    const config = this.loadConfig();
    
    const payload = {
      provider: config.provider,
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      model: config.model,
      enableThinking: !!config.enableThinking,
      currentState: currentState
    };

    const response = await fetch('/api/ai/document', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.markdown;
  }

  static async fetchModels(config) {
    const payload = {
      provider: config.provider,
      apiKey: config.apiKey,
      apiUrl: config.apiUrl
    };

    const response = await fetch('/api/ai/models', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.models || [];
  }

  static async testConnection(config) {
    const payload = {
      provider: config.provider,
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      enableThinking: !!config.enableThinking
    };

    const response = await fetch('/api/ai/test-connection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }
}
