import { IsString, IsOptional, IsNumber, IsBoolean, IsNotEmpty } from 'class-validator';

export class RestoreDto {
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @IsString()
  @IsOptional()
  host?: string;

  @IsNumber()
  @IsOptional()
  port?: number;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  database?: string;

  @IsBoolean()
  @IsOptional()
  dropExisting?: boolean;
}
