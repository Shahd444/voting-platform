import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min, MaxLength, ValidateIf, ValidateNested } from 'class-validator';

export class LocationDto {
  @IsNumber() @Min(-90) @Max(90) lat: number;
  @IsNumber() @Min(-180) @Max(180) lng: number;
  @ValidateIf((_, value) => value !== undefined) @IsNumber() @Min(0) accuracy?: number;
}

export class AccessCheckDto {
  @IsOptional() @ValidateNested() @Type(() => LocationDto) location?: LocationDto;
}

export class RequestOtpDto {
  @IsString() @Matches(/\S/, { message: 'Name cannot be blank.' }) @MaxLength(80) name: string;
  @IsString() @MaxLength(40) phone: string;
  @IsOptional() @IsBoolean() consent?: boolean;
  @IsOptional() @ValidateNested() @Type(() => LocationDto) location?: LocationDto;
}

export class VerifyOtpDto {
  @IsUUID() challengeId: string;
  @IsString() @Matches(/^\d{6}$/, { message: 'Code must be exactly 6 digits.' }) code: string;
}

export class VoteQrEntryDto {
  @IsString() @MaxLength(120) token: string;
}

export class CastVoteDto {
  @IsInt() @Min(1) @Max(2147483647) categoryId: number;
  @IsInt() @Min(1) @Max(2147483647) exhibitorId: number;
  @IsOptional() @ValidateNested() @Type(() => LocationDto) location?: LocationDto;
}
