import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DocumentKind,
  OuvrageStatus,
  OuvrageType,
  OuvrageUsage,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class ListOuvragesQueryDto extends PageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  communeId?: number;

  @ApiPropertyOptional({ enum: OuvrageStatus })
  @IsOptional()
  @IsEnum(OuvrageStatus)
  status?: OuvrageStatus;

  @ApiPropertyOptional({ enum: OuvrageType })
  @IsOptional()
  @IsEnum(OuvrageType)
  type?: OuvrageType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  certExpiringBefore?: string;
}

export class CreateOuvrageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sieId?: string;

  @ApiProperty({ enum: OuvrageType })
  @IsEnum(OuvrageType)
  type: OuvrageType;

  @ApiPropertyOptional({ enum: OuvrageUsage, default: OuvrageUsage.DOMESTIQUE })
  @IsOptional()
  @IsEnum(OuvrageUsage)
  usage?: OuvrageUsage = OuvrageUsage.DOMESTIQUE;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  village?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  communeId: number;

  @ApiProperty({ minimum: 1.6, maximum: 13.1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1.6)
  @Max(13.1)
  latitude: number;

  @ApiProperty({ minimum: 8.4, maximum: 16.2 })
  @Type(() => Number)
  @IsNumber()
  @Min(8.4)
  @Max(16.2)
  longitude: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  gpsAccuracyM?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  yearBuilt?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerPhone?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class UpdateOuvrageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  village?: string;

  @ApiPropertyOptional({ enum: OuvrageUsage })
  @IsOptional()
  @IsEnum(OuvrageUsage)
  usage?: OuvrageUsage;

  @ApiPropertyOptional({ enum: [OuvrageStatus.HORS_SERVICE] })
  @IsOptional()
  @IsEnum(OuvrageStatus)
  status?: OuvrageStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class UploadOuvrageDocumentDto {
  @ApiProperty({ enum: DocumentKind })
  @IsEnum(DocumentKind)
  kind: DocumentKind;
}

export class SieImportQueryDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dryRun?: boolean = false;

  @ApiPropertyOptional({
    description: 'Optional JSON column mapping override',
  })
  @IsOptional()
  @IsString()
  columnMapper?: string;
}
