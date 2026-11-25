import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthCodePurpose } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

export class OtpRequestDto {
  @ApiProperty({ example: '+237670000000' })
  @IsString()
  @MinLength(8)
  phone: string;

  @ApiPropertyOptional({
    enum: AuthCodePurpose,
    default: AuthCodePurpose.LOGIN,
  })
  @IsOptional()
  @IsEnum(AuthCodePurpose)
  purpose: AuthCodePurpose = AuthCodePurpose.LOGIN;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;
}

export class OtpVerifyDto {
  @ApiProperty({ example: '+237670000000' })
  @IsString()
  phone: string;

  @ApiProperty({ minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6)
  code: string;
}

export class StaffLoginDto {
  @ApiProperty({ description: 'Email or phone' })
  @IsString()
  @MinLength(3)
  identifier: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  password: string;
}

export class Verify2faDto {
  @ApiProperty()
  @IsString()
  mfaToken: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  code: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isBackupCode?: boolean = false;
}

export class Confirm2faDto {
  @ApiProperty()
  @IsString()
  @Length(6, 6)
  code: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class UpdateMeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: ['fr', 'en'] })
  @IsOptional()
  @IsIn(['fr', 'en'])
  locale?: 'fr' | 'en';
}
