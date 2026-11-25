import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SystemParamsService {
  constructor(private readonly prisma: PrismaService) {}

  async getNumber(key: string, fallback: number): Promise<number> {
    const param = await this.prisma.systemParameter.findUnique({
      where: { key },
    });
    if (!param) {
      return fallback;
    }
    const parsed = Number(param.value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async getString(key: string, fallback: string): Promise<string> {
    const param = await this.prisma.systemParameter.findUnique({
      where: { key },
    });
    if (!param || typeof param.value !== 'string') {
      return fallback;
    }
    return param.value;
  }

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const param = await this.prisma.systemParameter.findUnique({
      where: { key },
    });
    if (!param || param.value === null) {
      return fallback;
    }
    return param.value as T;
  }

  async set(
    key: string,
    value: Prisma.InputJsonValue,
    description?: string,
  ): Promise<void> {
    await this.prisma.systemParameter.upsert({
      where: { key },
      update: { value, ...(description ? { description } : {}) },
      create: { key, value, description },
    });
  }
}
