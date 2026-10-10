import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { ACCESS_MODES, AccessMode } from '../settings/settings.types';

export class LoginDto {
  @IsString() @MaxLength(64) username: string;
  @IsString() @MaxLength(200) password: string;
}
export class CodeDto { @IsString() @Matches(/^\d{6}$/, { message: 'Code must be exactly 6 digits.' }) code: string }
export class DisableMfaDto { @IsString() password: string; @Matches(/^\d{6}$/, { message: 'Code must be exactly 6 digits.' }) code: string }
export class ChangePasswordDto { @IsString() @MinLength(1) current: string; @IsString() @MinLength(10) @MaxLength(200) next: string }
export class CreateUserDto {
  @IsString() @Matches(/^[a-zA-Z0-9._-]{3,32}$/) username: string;
  @IsString() @MinLength(10) @MaxLength(200) password: string;
  @IsOptional() @IsIn(['admin', 'viewer']) role?: 'admin' | 'viewer';
}

export class CategoryDto {
  @IsString() @Matches(/\S/, { message: 'Name cannot be blank.' }) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(40) slug?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

/** Multipart form fields arrive as strings; parsed in CatalogService. */
export class ExhibitorFormDto {
  @IsString() @Matches(/\S/, { message: 'Name cannot be blank.' }) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(120) project?: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
  @IsOptional() @IsString() @MaxLength(20) booth?: string;
  @IsOptional() @IsIn(['true', 'false']) is_active?: string;
  @IsOptional() @IsString() category_ids?: string;
  @IsOptional() @IsIn(['true', 'false']) remove_photo?: string;
}

export class EventSettingsDto {
  @IsString() @Matches(/\S/, { message: 'Name cannot be blank.' }) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(120) tagline?: string;
  @IsOptional() @IsString() @MaxLength(120) venue?: string;
  @IsOptional() @IsString() @MaxLength(200) public_url?: string;
}
export class VotingSettingsDto {
  @IsOptional() @IsBoolean() open?: boolean;
  @IsOptional() @IsString() opens_at?: string | null;
  @IsOptional() @IsString() closes_at?: string | null;
  @IsOptional() @IsString() ended_at?: string | null;
}
export class GeofenceDto {
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lng: number;
  @IsNumber() @Min(10) @Max(50000) radius_m: number;
  @ValidateIf((_, value) => value !== undefined) @IsNumber() @Min(0) max_accuracy_m?: number;
}
export class AccessSettingsDto {
  @IsOptional() @IsIn(ACCESS_MODES) mode?: AccessMode;
  @IsOptional() @IsArray() @IsString({ each: true }) allowed_cidrs?: string[];
  @IsOptional() @ValidateNested() @Type(() => GeofenceDto) geofence?: GeofenceDto;
}
export class DisplaySettingsDto {
  @IsOptional() @IsBoolean() show_counts?: boolean;
  @IsOptional() @IsBoolean() show_winners?: boolean;
}

export class ResetDto {
  @IsString() @MinLength(1) @MaxLength(200) password: string;
  @IsOptional() @IsBoolean() purgeVisitors?: boolean;
}

export class RestartDto { @IsString() confirm: string }
