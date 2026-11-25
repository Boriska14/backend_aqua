import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

export enum MineeDecisionChoice {
  VALIDER = 'VALIDER',
  REJETER = 'REJETER',
}

export class MineeDecisionItemDto {
  @ApiProperty()
  @IsUUID()
  demandeId: string;

  @ApiProperty({ enum: MineeDecisionChoice })
  @IsEnum(MineeDecisionChoice)
  decision: MineeDecisionChoice;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class BatchValidateMineeDto {
  @ApiProperty({ type: [MineeDecisionItemDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MineeDecisionItemDto)
  decisions: MineeDecisionItemDto[];
}

export class CreateDelegationDto {
  @ApiProperty()
  @IsUUID()
  delegueId: string;

  @ApiProperty()
  @IsDateString()
  validFrom: string;

  @ApiProperty()
  @IsDateString()
  validUntil: string;

  @ApiProperty()
  @IsString()
  @MinLength(5)
  reason: string;
}
