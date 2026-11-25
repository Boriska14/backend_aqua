import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OuvrageType, OuvrageUsage } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class GrilleLigneDto {
  @ApiProperty({ enum: OuvrageType })
  @IsEnum(OuvrageType)
  ouvrageType: OuvrageType;

  @ApiProperty({ enum: OuvrageUsage })
  @IsEnum(OuvrageUsage)
  usage: OuvrageUsage;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount: number;
}

export class CreateGrilleDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ type: [GrilleLigneDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GrilleLigneDto)
  lignes: GrilleLigneDto[];
}

export class EstimationQueryDto {
  @ApiPropertyOptional()
  @IsUUID()
  ouvrageId: string;
}
