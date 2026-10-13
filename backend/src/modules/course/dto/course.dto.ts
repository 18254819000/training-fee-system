import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateCourseDto {
  @ApiProperty({ example: 'JP-N5' }) @IsString() @IsNotEmpty() @MaxLength(32) code!: string;
  @ApiProperty({ example: '日语 N5 基础班' }) @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

export class UpdateCourseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}

export class CreateFeeItemDto {
  @ApiProperty({ example: '日语 N5 班' }) @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() course_id?: string;
  @ApiProperty({ description: '所属校区 ID（收费项目只属于一个校区）' })
  @IsString() @IsNotEmpty()
  campus_id!: string;
  @ApiProperty({ example: 128000, description: '价格（分），必须为正整数' })
  @IsInt() @Min(1)
  amount_fen!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ description: '绑定的收费期 ID 列表（须属于同一校区）', type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  fee_period_ids?: string[];
}

export class UpdateFeeItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ example: 128000, description: '价格（分），必须为正整数' })
  @IsOptional() @IsInt() @Min(1)
  amount_fen?: number;
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}

/** 收费项目绑定收费期：全量替换该项目适用的收费期 */
export class SetFeeItemPeriodsDto {
  @ApiProperty({ description: '收费期 ID 列表（空数组=解绑全部）', type: [String] })
  @IsArray() @IsString({ each: true })
  fee_period_ids!: string[];
}

export class CourseQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() keyword?: string;
}

export class FeeItemQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() keyword?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() course_id?: string;
  @ApiPropertyOptional({ description: '所属校区 ID' }) @IsOptional() @IsString() campus_id?: string;
}
