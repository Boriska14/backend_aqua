import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaiementCanal } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class DeclarePaiementDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @ApiProperty({ enum: PaiementCanal })
  @IsEnum(PaiementCanal)
  canal: PaiementCanal;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  reference: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

export class RejectPaiementDto {
  @ApiProperty()
  @IsString()
  @MinLength(5)
  reason: string;
}
