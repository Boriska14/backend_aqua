import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SignalementCategorie, SignalementStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class CreateSignalementDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientUuid?: string;

  @ApiProperty({ enum: SignalementCategorie })
  @IsEnum(SignalementCategorie)
  category: SignalementCategorie;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1.6)
  @Max(13.1)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(8.4)
  @Max(16.2)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  qrToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPhone?: string;
}

export class ListSignalementsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SignalementStatus })
  @IsOptional()
  @IsEnum(SignalementStatus)
  status?: SignalementStatus;

  @ApiPropertyOptional({ enum: SignalementCategorie })
  @IsOptional()
  @IsEnum(SignalementCategorie)
  category?: SignalementCategorie;
}

export class UpdateSignalementDto {
  @ApiPropertyOptional({ enum: SignalementStatus })
  @IsOptional()
  @IsEnum(SignalementStatus)
  status?: SignalementStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resolutionNote?: string;
}
