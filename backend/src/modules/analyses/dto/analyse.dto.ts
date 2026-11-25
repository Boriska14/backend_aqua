import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyseStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class ListAnalysesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: AnalyseStatus })
  @IsOptional()
  @IsEnum(AnalyseStatus)
  status?: AnalyseStatus;
}

export class OpenAnalyseDto {
  @ApiProperty()
  @IsUUID()
  prelevementId: string;
}

export class AnalyseValueItemDto {
  @ApiProperty({ example: 'PH' })
  @IsString()
  @MinLength(1)
  parameterCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  presence?: boolean;
}

export class PutAnalyseValeursDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  analystComment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  analysedAt?: string;

  @ApiProperty({ type: [AnalyseValueItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AnalyseValueItemDto)
  values: AnalyseValueItemDto[];
}

export class AmendementChangeDto {
  @ApiProperty()
  @IsString()
  parameterCode: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  after?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  presence?: boolean;
}

export class CreateAmendementDto {
  @ApiProperty({ minLength: 20 })
  @IsString()
  @MinLength(20)
  reason: string;

  @ApiProperty({ type: [AmendementChangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AmendementChangeDto)
  changes: AmendementChangeDto[];
}

export enum AmendementDecisionChoice {
  APPROUVER = 'APPROUVER',
  REFUSER = 'REFUSER',
}

export class DecideAmendementDto {
  @ApiProperty({ enum: AmendementDecisionChoice })
  @IsEnum(AmendementDecisionChoice)
  decision: AmendementDecisionChoice;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
