import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OuvrageType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export enum PublicStatus {
  CERTIFIE = 'CERTIFIE',
  EXPIRE = 'EXPIRE',
  SUSPENDU = 'SUSPENDU',
  RETIRE = 'RETIRE',
  NON_CERTIFIE = 'NON_CERTIFIE',
}

export class PublicOuvragesQueryDto extends PageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  communeId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  regionId?: number;

  @ApiPropertyOptional({ enum: PublicStatus })
  @IsOptional()
  @IsEnum(PublicStatus)
  status?: PublicStatus;
}

export class PublicMapQueryDto {
  @ApiProperty({ example: '9.5,3.7,12.0,4.2' })
  @IsString()
  bbox: string;

  @ApiPropertyOptional({ enum: PublicStatus })
  @IsOptional()
  @IsEnum(PublicStatus)
  status?: PublicStatus;

  @ApiPropertyOptional({ enum: OuvrageType })
  @IsOptional()
  @IsEnum(OuvrageType)
  type?: OuvrageType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  communeId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  controlledSince?: string;
}

export interface PublicOuvrageDto {
  aquasafeNumber: string;
  name: string;
  village: string | null;
  communeName: string;
  type: OuvrageType;
  publicStatus: PublicStatus;
  validUntil: string | null;
  lastControlAt: string | null;
  latitude: number;
  longitude: number;
}
