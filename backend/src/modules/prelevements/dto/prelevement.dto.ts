import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PrelevementStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class ListPrelevementsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: PrelevementStatus })
  @IsOptional()
  @IsEnum(PrelevementStatus)
  status?: PrelevementStatus;
}

export class CreatePrelevementDto {
  @ApiProperty()
  @IsUUID()
  clientUuid: string;

  @ApiProperty()
  @IsUUID()
  demandeId: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  bottleCode: string;

  @ApiProperty()
  @IsDateString()
  collectedAt: string;

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
  @IsNumber()
  waterTempC?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  transportTempC?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transportNotes?: string;
}

export class SyncPrelevementsDto {
  @ApiProperty({ type: [CreatePrelevementDto], maxItems: 50 })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreatePrelevementDto)
  items: CreatePrelevementDto[];
}

export class ReceptionPrelevementDto {
  @ApiProperty()
  @IsBoolean()
  accepted: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
