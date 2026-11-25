import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CertificatStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class ListCertificatsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: CertificatStatus })
  @IsOptional()
  @IsEnum(CertificatStatus)
  status?: CertificatStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expiringInDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  communeId?: number;
}

export class ConfirmPlaqueDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  photoDocumentId?: string;
}

export class ReasonDto {
  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  reason: string;
}
