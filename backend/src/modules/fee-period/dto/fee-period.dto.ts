import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFeePeriodDto {
  @ApiProperty({ example: 'FP2026A' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code!: string;

  @ApiProperty({ example: '2026年秋季学期' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: '2026-09-01' })
  @IsString()
  @IsNotEmpty()
  start_date!: string;

  @ApiProperty({ example: '2027-01-31' })
  @IsString()
  @IsNotEmpty()
  end_date!: string;

  @ApiPropertyOptional({ description: '适用校区 ID 列表；为空表示全部校区', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  campus_ids?: string[];
}

export class UpdateFeePeriodDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  start_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  end_date?: string;

  @ApiPropertyOptional({ enum: ['draft', 'open', 'closed'], description: '只允许 draft→open→closed 单向流转' })
  @IsOptional()
  @IsIn(['draft', 'open', 'closed'])
  status?: 'draft' | 'open' | 'closed';

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  campus_ids?: string[];
}
