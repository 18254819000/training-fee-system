import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReservationCourseService } from './reservation-course.service';

// 公开读取：小程序首页游客也可看课程列表与详情（仅名称/详情/价格/截止日期，无隐私数据）。
// 购买仍走学生端会话接口，公开接口绝不创建订单。
@ApiTags('公开-预约课程')
@Controller('public/reservation-courses')
export class PublicReservationController {
  constructor(private readonly service: ReservationCourseService) {}

  @Get()
  @ApiOperation({ summary: '预约课程列表（公开；可按校区编码过滤）' })
  list(@Query('campusCode') campusCode?: string) {
    return this.service.publicList(campusCode);
  }

  @Get(':id')
  @ApiOperation({ summary: '预约课程详情（公开）' })
  detail(@Param('id') id: string) {
    return this.service.publicDetail(id);
  }
}
