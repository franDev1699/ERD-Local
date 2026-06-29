// src/services/AiService.js

export class AiService {
  static CONFIG_KEY = 'erd_ai_config';

  static getDefaultConfig() {
    return {
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      apiKey: '',
      apiUrl: 'http://localhost:11434'
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

  static saveConfig(config) {
    try {
      localStorage.setItem(this.CONFIG_KEY, JSON.stringify(config));
      return true;
    } catch (e) {
      console.error('Error al guardar configuración de IA:', e);
      return false;
    }
  }

  static async generate(prompt, currentState = null, mode = 'replace', extraParams = {}) {
    const config = this.loadConfig();
    
    const payload = {
      provider: config.provider,
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      model: config.model,
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
}
