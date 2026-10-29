import { Module } from '@nestjs/common';
import { CompaniesController, InvitationsController, MembersController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { InvitationsService } from './invitations.service';
import { MembersService } from './members.service';

@Module({
  controllers: [CompaniesController, MembersController, InvitationsController],
  providers: [CompaniesService, MembersService, InvitationsService],
})
export class CompaniesModule {}
