import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class RefundQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() campus_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
}
