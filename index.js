#!/usr/bin/env node
/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2025. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */

import { program } from 'commander';
import * as commands from './cmd/index.js'

program
  .name('index.js')
  .description('Tools and utilities for the IBM Cloud Continuous Delivery service and resources.')
  .version('0.0.1')
  .showHelpAfterError();

for (let i in commands) {
    program.addCommand(commands[i]);
}

program.parseAsync();
