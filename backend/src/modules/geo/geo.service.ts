import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GeoService {
  constructor(private readonly prisma: PrismaService) {}

  listRegions() {
    return this.prisma.region.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true },
    });
  }

  listCommunes(regionId?: number) {
    return this.prisma.commune.findMany({
      where: regionId ? { regionId } : undefined,
      orderBy: { name: 'asc' },
      select: { id: true, regionId: true, code: true, name: true },
    });
  }
}
