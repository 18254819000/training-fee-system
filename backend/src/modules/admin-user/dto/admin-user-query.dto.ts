import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class AdminUserQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() keyword?: string;
}

export class AuditLogQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() actor_type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() result?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() keyword?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() date_from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() date_to?: string;
}
