import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role, UserStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class ListUsersQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class CreateUserDto {
  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role: Role;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  fullName: string;

  @ApiProperty({ example: '+237670000000' })
  @IsString()
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(10)
  initialPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  communeId?: number;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  communeScopeIds?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  laboratoireId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organisationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  habilitationUntil?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  communeId?: number;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  communeScopeIds?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  laboratoireId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  habilitationUntil?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reset2fa?: boolean;
}
