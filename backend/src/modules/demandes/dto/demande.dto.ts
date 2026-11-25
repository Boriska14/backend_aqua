import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ContreAnalysePayeur,
  DemandeStatus,
  DemandeType,
} from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class ListDemandesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: DemandeStatus })
  @IsOptional()
  @IsEnum(DemandeStatus)
  status?: DemandeStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ouvrageId?: string;
}

export class CreateDemandeDto {
  @ApiProperty()
  @IsUUID()
  ouvrageId: string;

  @ApiPropertyOptional({ enum: DemandeType, default: DemandeType.INITIALE })
  @IsOptional()
  @IsEnum(DemandeType)
  type?: DemandeType = DemandeType.INITIALE;
}

export class SubmitDemandeDto {
  @ApiProperty()
  @IsUUID()
  laboratoireId: string;
}

export enum CommuneDecision {
  VALIDER = 'VALIDER',
  REJETER = 'REJETER',
}

export class CommuneValidationDto {
  @ApiProperty({ enum: CommuneDecision })
  @IsEnum(CommuneDecision)
  decision: CommuneDecision;

  @ApiPropertyOptional({ description: 'Obligatoire si REJETER' })
  @IsOptional()
  @IsString()
  @MinLength(5)
  reason?: string;
}

export class CreateContreAnalyseDto {
  @ApiProperty()
  @IsUUID()
  laboratoireId: string;

  @ApiProperty({ enum: ContreAnalysePayeur })
  @IsEnum(ContreAnalysePayeur)
  payeur: ContreAnalysePayeur;
}
