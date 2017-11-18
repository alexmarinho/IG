# -*- coding: utf-8 -*-
import re
import db
import numpy as np
import pandas as pd
import json
import ig

@ig.timer
def load_regex(csv):
    """ Load the parameters from the CSV instance file"""
    activity, matrix, due, mode = [], [], [], []
    with open(csv) as instances:
        for instance in instances:
            if re.search('^MODEL,', instance):  # Instance Name
                model = instance.split(',')
            elif re.search('^RESOURCE', instance):  # Initial Setup
                resource = instance.strip('\n').split(',')
            elif re.search('^ACTIVITY,', instance):  # Families Setup
                if model[1][:3] == 'STC':  # Instances without STC Name don't have
                    activity.append(instance.split(','))
                else:
                    activity.append([0, 0, 0])
            elif re.search('^SETUP_MATRIX,', instance):
                matrix.append(list(map(int, instance[15:].strip('\n').split(','))))
            elif re.search('^DUE_DATE,', instance):  # DUE_TIME, TARDINESS_VARIABLE_COST
                due.append(instance.strip('\n').split(','))
            elif re.search('^MODE,', instance):   # MODE_COST,PROCESSING_TIME,release_date,START_MAX, END_MIN, END_MAX,
                mode.append(instance.split(','))  # UNPERFORMED_COST, UNPERFORMED_SETUP_TIME, UNPERFORMED_SETUP_COST
    if model[1][:3] != 'STC':
        matrix = [0, 0, 0, 0, 0]

    with open('benchmark.json') as json_file:  # benchmark.json contains [n of Jobs, best fitness] for each instance
        best_fitness = json.load(json_file)
    db.parameters['_instance_name'] = model[1] 
    db.parameters['_total_jobs'] = best_fitness[model[1]][0]
    #db.parameters['_best_fitness'] = best_fitness[model[1]][1]
    del best_fitness

    db.matrix = np.matrix(matrix)
    db.parameters['_initial_setup'] = int(resource[3])
    db.parameters['_total_families'] = int(len(matrix) ** 0.5)
    db.parameters['_end_max'] = int(mode[0][10])


    # Create Jobs Objects
    for instances in range(db.parameters['_total_jobs']):
        db.j.append(db.Jobs(int(activity[instances][2]),        # Setup Family
                            int(mode[instances][7]),            # Start Min
                            int(due[instances][2]),             # Due Date
                            int(mode[instances][6]),            # Process Time
                            int(mode[instances][5]),            # Mode Cost
                            int(mode[instances][11]),           # Unperformed Cost and
                            float(due[instances][5])))          # Tardiness Cost

    # Create the Initial Solution
    db.calc = np.array([
        [x,  # [0]Job
         0 if db.j[x]._mode_cost < db.j[x]._unperformed_cost else 2,  # [1]Processed?
         0,  # [2] Setup Time                                              0 NO
         0,  # [3] Setup Cost                                              1 YES
         0,  # [4] Deadline                                                2 NEVER
         0,  # [5] Slack Time
         0,  # [6] Start Max
         0,  # [7] Setup Initial Time
         0,  # [8] Process Initial Time
         0,  # [9] Process End Time
         0,  # [10]Tardiness Cost
         db.j[x]._unperformed_cost  # [11] Total Cost
         ] for x in range(db.parameters['_total_jobs'])])
    ig.sum_instance_cost()
    db.unperformed = list(range(db.parameters['_total_jobs']))
    ig.update_best_runtime_solution()
    # Separate jobs 100% unperformed
    for instances in list(map(int, np.argwhere(db.calc[:, 1]))):
        db.unperformed2.append(instances)   # Giving the indices of non zero value
        db.unperformed.remove(instances)


def load_pandas(csv):
    """Load function used in the GUI"""
    ig.reset_variables()
    tables = ['RESOURCE', 'SETUP_MATRIX', 'ACTIVITY', 'DUE_DATE', 'MODE']
    i = pd.read_csv(csv, skiprows=7, names=list(range(14)), engine='python')
    i = {section: i[i[0].str.startswith(section) & ~ i[0].str.endswith(('KEYS', 'TYPES'))].dropna(axis=1)
         for section in tables}

    if 'STC' not in csv:  # Standardizes columns of the instances without Setup
        i['SETUP_MATRIX'] = pd.DataFrame([[0, 'SETUP_MATRIX_ID', 'FROM_STATE', 'TO_STATE', 'SETUP_TIME', 'SETUP_COST']
                                             , ['0']*6])
        i['ACTIVITY'].insert(3, '=)', ['SETUP_STATE'] + [0] * (len(i['ACTIVITY']) - 1))
        i['RESOURCE'].insert(3, '=)', ['INITIAL_SETUP_STATE', 0])

    #  Use the first row as Columns labels, reset index and delete unnecessary columns
    # i = {x: i[x].drop([0, 1], axis=1).rename(columns=i[x].iloc[0]).drop(i[x].index[0]).reset_index(drop=True)
    #     for x in tables}
    i = {x: i[x].drop([0, 1], axis=1).rename(columns=i[x].iloc[0]).drop(i[x].index[0]).reset_index(drop=True)
         for x in tables}
    # db.matrix_pandas = i['SETUP_MATRIX'].set_index(["FROM_STATE", "TO_STATE"])  # ORIGINAL LOAD_PANDAS
    db.matrix_pandas = i['SETUP_MATRIX'].astype(int)  # Modified

    # To search use matrix.loc[('family job1','family job2'),'SETUP_TIME']
    # Delete unnecessary columns
    i['MODE'].drop(['MODE_ID','RESOURCE_ID', 'REQUIRED_CAPACITY','UNPERFORMED_SETUP_TIME', 'UNPERFORMED_SETUP_COST' ], axis=1, inplace=True)
    # Merge dataframes in one object j
    db.j_pandas = pd.concat([i['MODE'], i['ACTIVITY']['SETUP_STATE']], axis=1)
    db.j_pandas = pd.concat([db.j_pandas, i['DUE_DATE']['DUE_TIME']], axis=1)
    db.j_pandas = pd.concat([db.j_pandas, i['DUE_DATE']['TARDINESS_VARIABLE_COST']], axis=1).reset_index()
    columns = ['index', 'START_MIN', 'PROCESSING_TIME', 'DUE_TIME', 'END_MAX','SETUP_STATE',  'MODE_COST',
               'UNPERFORMED_COST', 'TARDINESS_VARIABLE_COST','START_MAX', 'END_MIN']
    #db.j_pandas[columns] = db.j_pandas[columns].apply(pd.to_numeric)
    db.j_pandas = db.j_pandas[columns].apply(pd.to_numeric)
    db.j_pandas.columns = db.j_pandas.columns.str.replace('index', 'JOB')

    db.j_pandas_describe = db.j_pandas.describe().round(2)
    db.j_pandas_describe = db.j_pandas_describe.astype(int)
    db.j_pandas_describe.drop(['JOB', 'SETUP_STATE', 'START_MAX', 'END_MIN'], axis=1, inplace=True)
    db.j_pandas_describe.drop(['count'], axis=0, inplace=True)
    db.parameters['_initial_setup'] = int(i['RESOURCE']['INITIAL_SETUP_STATE'])