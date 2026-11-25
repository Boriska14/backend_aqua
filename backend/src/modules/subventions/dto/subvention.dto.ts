import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateSubventionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  demandeId!: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  justificatifDocumentIds?: string[];
}

export class CommuneSubventionDecisionDto {
  @ApiProperty()
  @IsBoolean()
  eligible!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  criterion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class MineeSubventionDecisionDto {
  @ApiProperty()
  @IsBoolean()
  accorder!: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((o: MineeSubventionDecisionDto) => o.accorder === true)
  @IsUUID()
  enveloppeId?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @ValidateIf((o: MineeSubventionDecisionDto) => o.accorder === true)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount?: number;

  @ApiPropertyOptional()
  @ValidateIf((o: MineeSubventionDecisionDto) => o.accorder === false)
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class CreateEnveloppeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  financeur!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  total!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  communeId?: number;
}
