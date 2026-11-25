import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SeuilType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateNormeDto {
  @ApiProperty({ example: 'NC 207' })
  @IsString()
  @MinLength(2)
  code: string;

  @ApiProperty({ example: 'v1' })
  @IsString()
  @MinLength(1)
  version: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  copyFromId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  validityMonths?: number;
}

export class SeuilItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  parameterCode: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  label: string;

  @ApiProperty({ enum: SeuilType })
  @IsEnum(SeuilType)
  type: SeuilType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minValue?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxValue?: number | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isCritical?: boolean = false;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean = true;
}
