import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000) // 单页上限 1000（下拉框取全量场景需要 >100；防一次性导出过量数据）
  pageSize?: number = 20;
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}
