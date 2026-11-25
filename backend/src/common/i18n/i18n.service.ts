import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export type SupportedLocale = 'fr' | 'en';

type Dict = Record<string, unknown>;

@Injectable()
export class I18nService {
  private readonly dictionaries: Record<SupportedLocale, Dict>;
  private readonly defaultLocale: SupportedLocale;

  constructor(configService: ConfigService) {
    this.defaultLocale = configService.get<SupportedLocale>(
      'DEFAULT_LOCALE',
      'fr',
    );
    this.dictionaries = {
      fr: this.loadDictionary('fr.json'),
      en: this.loadDictionary('en.json'),
    };
  }

  resolveLocale(acceptLanguage?: string): SupportedLocale {
    if (!acceptLanguage) {
      return this.defaultLocale;
    }
    const normalized = acceptLanguage.toLowerCase();
    if (normalized.startsWith('en') || normalized.includes(',en')) {
      return 'en';
    }
    if (normalized.startsWith('fr') || normalized.includes(',fr')) {
      return 'fr';
    }
    return this.defaultLocale;
  }

  t(key: string, locale?: SupportedLocale, fallback?: string): string {
    const lang = locale ?? this.defaultLocale;
    const value =
      this.lookup(this.dictionaries[lang], key) ??
      this.lookup(this.dictionaries[this.defaultLocale], key);
    if (typeof value === 'string') {
      return value;
    }
    return fallback ?? key;
  }

  private lookup(dict: Dict, key: string): unknown {
    return key.split('.').reduce<unknown>((acc, segment) => {
      if (acc && typeof acc === 'object' && segment in acc) {
        return (acc as Dict)[segment];
      }
      return undefined;
    }, dict);
  }

  private loadDictionary(filename: string): Dict {
    const candidates = [
      path.join(__dirname, filename),
      path.join(process.cwd(), 'src', 'common', 'i18n', filename),
    ];
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as Dict;
      }
    }
    return {};
  }
}
