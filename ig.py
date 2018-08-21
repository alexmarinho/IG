# -*- coding: utf-8 -*-
import db
import copy
import random
import timeit
import collections
import numpy as np
import pandas as pd
from functools import wraps
from PyQt5 import QtCore, QtGui, QtWidgets

def timer(f):
    """Decorator to count the executions and runtime of the functions"""
    @wraps(f)  # Used to allow the app access the __doc__ of decorated functions
    def timed(*args, **kwargs):
        ts = timeit.default_timer()
        result = f(*args, **kwargs)
        te = timeit.default_timer()
        if f.__name__ not in db.functions_timer: db.functions_timer[f.__name__] = [0, 0]  # Create a new entry dynamically
        db.functions_timer[f.__name__][0] += 1
        db.functions_timer[f.__name__][1] += te-ts
        return result
    return timed


def ig():
    try:
        while db.parameters['_best_fitness'] < db.results['fitness_runtime'] and db.parameters['_stop_time'] > db.results['runtime']:
            qtt_jobs = destroy_qtt(db.parameters['_jobs_to_destroy'])  # How many jobs to be destroyed?
            destroy(qtt_jobs)
            insert()
            if db.parameters['_permutation']: 
                swap()
            if db.results['fitness_iteration'] < db.results['fitness_runtime']:  # save if a best solution is found
                update_best_runtime_solution()
            if db.parameters['_solution_to_destroy'] == 'best':  # Which solution should be destroyed?
                restore_best_runtime_solution()
            time_iteration()  # Update Runtime
        results()  # Stopping Condition achieved, print results
    except FileNotFoundError:
        print('Error: Instance not Found')


@timer
def destroy_qtt(option):
    """Define how many jobs will be destroyed in each iteration.

CALLED BY: ig()

CALLING: random.randint()
                  random.triangular()"""
    if type(option) == int:
        jobs_to_destroy = option
    elif len(option) == 2:
        jobs_to_destroy = random.randint(option[0], option[1])
    else:
        jobs_to_destroy = round(random.triangular(option[0], option[1], option[2]))
    return jobs_to_destroy


@timer
def destroy(qtt):
    """Destroy performed jobs randomly, updating the new sequence and the costs.

CALLED BY: ig()

CALLING: random.sample()
                  remove_performed_jobs()
                  update_job_position(),
                  sum_instance_cost()"""
    db.jobs_destroyed = random.sample(db.performed, min(qtt, len(db.performed)))
    remove_performed_jobs(db.jobs_destroyed)

    for index in range(len(db.performed)):
        update_job_position(index)
    sum_instance_cost()


@timer
def insert():
    """Insert unperformed jobs in the best positions possible, updating the new sequence and the costs.

CALLED BY: ig()

CALLING: random.sample()
                  backup_inserted()
                  available_positions()
                  insert_job()
                  update_iterated()
                  restore_inserted()
                  restore_iterated()"""
    for job in random.sample(db.unperformed, len(db.unperformed)):  # unperformed mixed
        update_iterated()
        backup_inserted()
        for position in range(*available_positions(job)):
            insert_job(job, position)
            if db.results['fitness_iteration'] < db.i_results['fitness_iteration']:
                update_iterated()
            restore_inserted()
        restore_iterated()


@timer
def swap():
    """Swap unperformed jobs with possible performed jobs, and update the new sequence and the costs.

CALLED BY: ig()

CALLING: random.sample()
                  backup_inserted()
                  available_positions()
                  remove_performed_jobs()
                  insert_job()
                  update_iterated()
                  restore_inserted()
                  restore_iterated()"""
    for job in random.sample(db.unperformed, len(db.unperformed)):  # mix unperformed
        update_iterated()
        backup_inserted()
        x, y = available_positions(job)
        for position in range(x, y - 1):
            job_p = [db.performed[position]]
            remove_performed_jobs(job_p)
            insert_job(job, position)
            if db.results['fitness_iteration'] < db.i_results['fitness_iteration']:
                update_iterated()
            restore_inserted()
    restore_iterated()
    
    
@timer
def remove_performed_jobs(jobs_destroyed):
    """Update the variables of the successor job in the sequence, and remove the selected performed job.

CALLED BY: destroy()
                     swap()

CALLING: update_job_variables_first()
                  update_job_variables()"""
    for job in jobs_destroyed:
        index = db.performed.index(job)
        if job != db.performed[-1]:
            if index == 0:
                update_job_variables_first(db.performed[index + 1])
            else:
                update_job_variables(db.performed[index - 1], db.performed[index + 1])

        db.performed.remove(job)
        db.unperformed.append(job)
        db.calc[job, 1:11] = [0]  # reset the unperformed job variables
        db.calc[job, 11] = db.j[job]._unperformed_cost  # Job cost = unperformed cost
        

@timer
def available_positions(job):
    """Return the range of positions for an unperformed job to be inserted or swapped.

CALLED BY: insert()
                     swap()

CALLING: initial_position()
                  final_position()
"""
    return initial_position(job), final_position(job) + 1


@timer
def initial_position(job):
    """Return the first possible position to insert a job in the sequence.
Release Time [job] - setup_time[job] < finished_process_time[predecessor_job]

CALLED BY: available_positions()

CALLING: setup_time()"""
    for pos in range(len(db.performed)):
        if db.j[job]._release_date - setup_time(db.performed[pos], job) < db.calc[db.performed[pos], 9]:
            return pos
    return len(db.performed)


@timer
def final_position(job):
    """Return the last possible position to insert a job in the sequence. The search starts from the last performed job.

CALLED BY: available_positions()

CALLING: break_even()
                  setup_time()"""
    for pos in range(len(db.performed)-1, 0, -1):
        start_max = break_even(db.performed[pos], job) - db.j[job]._process_time
        if db.calc[db.performed[pos], 9] + setup_time(db.performed[pos], job) <= start_max:
            return pos + 1
    return 0


@timer
def insert_job(job, position):
    """Insert or swap a job in a specific position, following the steps below:
1) Update Setup, Times and Costs changes between the job inserted, successor and predecessor jobs;
2) Insert in Performed list and delete from unperformed;
3) update all the jobs with changed variables.

CALLED BY: insert()
                     swap()

CALLING: update_job_variables_first()
                  update_job_variables()
                  update_job_position()
                  after_break_even()
                  sum_instance_cost()
                  unchanged_job()"""

    db.calc[job, 1] = 1
    if position == 0:
        update_job_variables_first(job)
    else:
        update_job_variables(db.performed[position - 1], job)
    if position < len(db.performed):
        update_job_variables(job, db.performed[position])

    db.performed.insert(position, job)
    db.unperformed.remove(job)

    for pos in range(position, len(db.performed)):
        update_job_position(pos)
        #if unchanged_job(pos):
        #    break
        if after_break_even(pos):
            return
    sum_instance_cost()


@timer
def break_even(pre_job, job):
    """Return the point at the costs to perform a job is lower than to unperformed.
This value is dynamic, related to the setup costs that can be varied, depending on the previous job.

CALLED BY: final_position()
                     update_job_variables()

CALLING: setup_cost()"""

    x = min(db.parameters['_end_max'], db.j[job]._due_date + ((db.j[job]._unperformed_cost - setup_cost(pre_job, job) - db.j[job]._mode_cost)/ db.j[job]._tardiness_cost))
    return int(max(db.j[job]._due_date, x))


@timer
def break_even_first(job):
    """Return the break_even for the initial job of the sequence.

CALLED BY: update_job_variables_first()

CALLING: setup_cost_first()"""

    x = min(db.parameters['_end_max'], db.j[job]._due_date + ((db.j[job]._unperformed_cost - setup_cost_first(job) - db.j[job]._mode_cost) / db.j[job]._tardiness_cost))
    return int(max(db.j[job]._due_date, x))


@timer
def setup_cost_first(job):
    """Return the setup cost for the initial job of the sequence.

CALLED BY: break_even_first()
                     update_job_variables_first()

CALLING: -"""
    return db.matrix[(db.parameters['_total_families'] * db.parameters['_initial_setup'] + db.j[job]._setup_family), 3]


@timer
def update_job_variables(pre_job, job):
    """Update Setup Time, Setup Cost, Break Even point, Slack Time and Start Max for a inserted job.

CALLED BY: insert_job()
                     remove_performed_jobs()

CALLING: setup_time()
                  setup_cost()
                  break_even()"""
    db.calc[job, 2] = setup_time(pre_job, job)
    db.calc[job, 3] = setup_cost(pre_job, job)
    db.calc[job, 4] = break_even(pre_job, job)
    db.calc[job, 5] = db.calc[job, 4] - db.j[job]._process_time - db.j[job]._release_date  # Slack Time
    db.calc[job, 6] = db.calc[job, 4] - db.j[job]._process_time  # Start Max


@timer
def update_job_variables_first(job):
    """Update variables for the initial job of the sequence.

CALLED BY: insert_job()
                     remove_performed_jobs()

CALLING: setup_cost_first()
                  break_even_first()"""
    db.calc[job, 2] = db.matrix[(db.parameters['_total_families'] * db.parameters['_initial_setup'] + db.j[job]._setup_family), 2]  # Setup Time
    db.calc[job, 3] = setup_cost_first(job)
    db.calc[job, 4] = break_even_first(job)
    db.calc[job, 5] = db.calc[job, 4] - db.j[job]._process_time - db.j[job]._release_date
    db.calc[job, 6] = db.calc[job, 4] - db.j[job]._process_time  # Start Max


@timer
def update_job_position(index):
    """Update the time and the costs of a job, processing that job as soon as possible.

CALLED BY: destroy()
                     insert_job()

CALLING: max()"""
    job = db.performed[index]
    # Setup start = MAX(Predecessor job Finish; release_date - Setup Time)
    db.calc[job, 7] = max(0 if index == 0 else db.calc[db.performed[db.performed.index(job) - 1], 9], db.j[job]._release_date - db.calc[job, 2])
    db.calc[job, 8] = db.calc[job, 7] + db.calc[job, 2]  # Start Process Time
    db.calc[job, 9] = db.calc[job, 8] + db.j[job]._process_time  # Finish Process Time
    db.calc[job, 10] = max(0, (db.calc[job, 9] - db.j[job]._due_date) * db.j[job]._tardiness_cost)  # Penalty Cost
    db.calc[job, 11] = db.calc[job, 3] + db.j[job]._mode_cost + db.calc[job, 10]  # Total Job Cost


@timer
def setup_time(pre_job, job):
    """Calculate the setup_time of a job.

CALLED BY: update_job_variables()
                     initial_position()
                     final_position()

CALLING: -"""
    return db.matrix[(db.parameters['_total_families'] * db.j[pre_job]._setup_family + db.j[job]._setup_family), 2]


@timer
def setup_cost(pre_job, job):
    """Calculate the setup_cost of a job.

CALLED BY: break_even()
                     update_job_variables()

CALLING: -"""
    return db.matrix[(db.parameters['_total_families'] * db.j[pre_job]._setup_family + db.j[job]._setup_family), 3]


@timer
def backup_inserted():
    """Make the backup of the solution in order to attempt to insert a job in all possible positions.

CALLED BY: insert()
                     swap()

CALLING: copy.deepcopy()"""
    db.b_calc = copy.deepcopy(db.calc)
    db.b_results['fitness_iteration'] = db.results['fitness_iteration']
    db.b_performed = copy.deepcopy(db.performed)
    db.b_unperformed = copy.deepcopy(db.unperformed)


@timer
def update_best_runtime_solution():
    """Update the optimum solution found during the runtime.

CALLED BY: ig()

CALLING: copy.deepcopy()
                  timeit.default_timer()"""
    db.c_calc = copy.deepcopy(db.calc)
    db.c_results['fitness_iteration'] = db.results['fitness_iteration']
    db.c_performed = copy.deepcopy(db.performed)
    db.c_unperformed = copy.deepcopy(db.unperformed)

    db.results['fitness_runtime'] = int(db.results['fitness_iteration'])
    db.results['runtime'] = timeit.default_timer() - db.time_start

    db.results['log'].append([db.results['fitness_runtime'],
                              db.results['runtime'],
                              db.results['iterations'],
                              db.performed,
                              db.jobs_destroyed,
                              db.unperformed + db.unperformed2])

@timer
def update_iterated():
    """Update the iterated solution in case the job inserted outcome in a better solution.

CALLED BY: insert()
                     swap()

CALLING: copy.deepcopy()"""
    db.i_calc = copy.deepcopy(db.calc)
    db.i_results['fitness_iteration'] = db.results['fitness_iteration']
    db.i_performed = copy.deepcopy(db.performed)
    db.i_unperformed = copy.deepcopy(db.unperformed)


@timer
def restore_inserted():
    """Restore the solution saved before the insertion of jobs in each possible position.
    
CALLED BY: insert()
                     swap()

CALLING: copy.deepcopy()"""
    db.calc = copy.deepcopy(db.b_calc)
    db.results['fitness_iteration'] = db.b_results['fitness_iteration']
    db.performed = copy.deepcopy(db.b_performed)
    db.unperformed = copy.deepcopy(db.b_unperformed)


@timer
def restore_best_runtime_solution():
    """Restore the best solution found during the runtime to be destroyed in the next iteration.

CALLED BY: ig()

CALLING: copy.deepcopy()"""
    db.calc = copy.deepcopy(db.c_calc)
    db.results['fitness_iteration'] = db.c_results['fitness_iteration']
    db.performed = copy.deepcopy(db.c_performed)
    db.unperformed = copy.deepcopy(db.c_unperformed)
    db.results['fitness_iteration'] = db.results['fitness_runtime']


@timer
def restore_iterated():
    """Restore the best iterated solution when the process of insertion or swapping is over.

CALLED BY: insert()
                     swap()

CALLING: copy.deepcopy()"""

    db.calc = copy.deepcopy(db.i_calc)
    db.results['fitness_iteration'] = db.i_results['fitness_iteration']
    db.performed = copy.deepcopy(db.i_performed)
    db.unperformed = copy.deepcopy(db.i_unperformed)


@timer
def sum_instance_cost():
    """Summarize all the jobs costs.

CALLED BY: destroy()
                     insert_job()

CALLING: numpy.sum()"""
    db.results['fitness_iteration'] = np.sum(db.calc[:, 11])


@timer
def time_iteration():
    """Update the Runtime and iterations.

CALLED BY: ig()

CALLING: timeit.default_timer()"""
    db.results['runtime'] = timeit.default_timer() - db.time_start
    db.results['iterations'] += 1


@timer
def unchanged_job(index):
    """Check if a specific job didn't change costs and position when a predecessor job had been inserted.
The goal is to interrupt the update process for jobs without alterations.
        
CALLED BY: insert_job()

CALLING: - """
    return True if db.calc[db.performed[index], 9] == db.b_calc[db.performed[index-1], 9] and db.calc[db.performed[index], 11] == db.b_calc[db.performed[index-1], 11] else False


@timer
def after_break_even(position):
    """Check if a job is performed after the break even point.

CALLED BY: insert_job()

CALLING: - """
    return True if db.calc[db.performed[position], 9] >= db.calc[db.performed[position], 4] else False


def reset_variables():
    db.results = {
        'fitness_iteration': 0,
        'fitness_runtime': 0,
        'runtime': 0,
        'iterations': 0,
        'log': []}
    db.functions_timer = collections.defaultdict(list)
    db.time_start = timeit.default_timer()

    db.j, db.matrix, db.j_pandas, db.matrix_pandas = [], [], [], []
    db.calc, db.performed, db.unperformed, db.unperformed2 = [], [], [], []
    db.b_calc, db.b_results, db.b_performed, db.b_unperformed = [], {}, [], []
    db.i_calc, db.i_results, db.i_performed, db.i_unperformed = [], {}, [], []
    db.c_calc, db.c_results, db.c_performed, db.c_unperformed = [], {}, [], []
    db.result_pandas, db.jobs_destroyed = [], []


def results():
    """ Create the Pandas Results DataFrames."""

    col = ['Job', 'Status', 'setup_time', 'Setup_Cost', 'break_even',
           'slack_time', 'start_max', 'Start_Setup',
           'Start_Process', 'Finish_Process', 'Penalty_Cost', 'Total_Cost']
    db.result_pandas = pd.DataFrame(db.calc, index=np.arange(db.parameters['_total_jobs']), columns=col)
    db.result_pandas['Status'].replace([0, 2], 'Unperformed', inplace=True)
    db.result_pandas['Status'].replace([1], 'Performed', inplace=True)
    db.result_pandas.drop(['setup_time', 'break_even', 'slack_time', 'start_max'], axis=1, inplace=True)
    columns = ['Job', 'Status', 'Start_Setup', 'Start_Process', 'Finish_Process', 'Setup_Cost',
               'Penalty_Cost', 'Total_Cost']
    db.result_pandas = db.result_pandas[columns]
    db.result_pandas.sort_values(['Status', 'Start_Setup'], ascending=[True, True], inplace=True)
    db.result_pandas = db.result_pandas.reset_index(level=0, drop=True)

    col = ['Solution', 'Runtime', 'Iteration', 'Performed Jobs', 'Destroyed', 'Unperformed']

    #  BUG - First Log are registering a job performed instead to let the space empty
    db.results['log'][0][3] = []
    db.results['log'] = pd.DataFrame(db.results['log'], columns=col)
    db.results['log'] = db.results['log'].sort_values(['Solution'], ascending=[True]).reset_index(level=0, drop=True)

    db.results['log'].columns = col
    #db.results['log'][col_int] = db.results['log'][col_int].apply(pd.to_numeric)
    db.results['log'] = db.results['log'].sort_index(axis=0, ascending=True).round(3)

    columns = ['Function','Executions', 'Time Sum','Average Time (ms)', 'Total Time (%)']

    for x in db.functions_timer:
        db.functions_timer[x].append(db.functions_timer[x][1]/db.functions_timer[x][0] * 1000)
        db.functions_timer[x].append(100 * db.functions_timer[x][1] / db.results['runtime'])

    db.functions_timer = pd.DataFrame.from_dict(db.functions_timer)
    db.functions_timer = db.functions_timer.transpose()
    db.functions_timer = db.functions_timer.reset_index().round(4)
    db.functions_timer.columns = columns
    db.functions_timer['Executions'] = db.functions_timer['Executions'].astype(int)
    #      db.results['log'] = db.results['log'].astype(int).sort_index(axis=0, ascending=True)
    #columnsint = ['', 'Solution', 'Performed', 'Unperformed', 'Iteration']
    #db.results['log'][[columnsint]] = db.results['log'][[columnsint]].asType(int)


class Ui_About(object):
    def setupUi(self, About):
        About.setObjectName("About")
        About.resize(404, 165)
        self.label = QtWidgets.QLabel(About)
        self.label.setGeometry(QtCore.QRect(10, 10, 401, 21))
        font = QtGui.QFont()
        font.setPointSize(8)
        font.setBold(False)
        font.setWeight(50)
        self.label.setFont(font)
        self.label.setObjectName("label")
        self.label_2 = QtWidgets.QLabel(About)
        self.label_2.setGeometry(QtCore.QRect(10, 40, 61, 16))
        self.label_2.setObjectName("label_2")
        self.label_3 = QtWidgets.QLabel(About)
        self.label_3.setGeometry(QtCore.QRect(10, 100, 281, 16))
        self.label_3.setObjectName("label_3")
        self.label_4 = QtWidgets.QLabel(About)
        self.label_4.setGeometry(QtCore.QRect(10, 60, 251, 16))
        self.label_4.setObjectName("label_4")
        self.pushButton = QtWidgets.QPushButton(About)
        self.pushButton.setGeometry(QtCore.QRect(170, 130, 75, 23))
        self.pushButton.setObjectName("pushButton")

        self.retranslateUi(About)
        self.pushButton.clicked.connect(About.close)
        QtCore.QMetaObject.connectSlotsByName(About)

    def retranslateUi(self, About):
        _translate = QtCore.QCoreApplication.translate
        About.setWindowTitle(_translate("About", "About IG"))
        self.label.setText(_translate("About", "IG is a Metaheuristic applied in scheduling with rejection and tardiness penalties."))
        self.label_2.setText(_translate("About", "Version 0.1"))
        self.label_3.setText(_translate("About", "Copyright 2017, Alex Marinho (alexmarinho@gmail.com)"))
        self.label_4.setText(_translate("About", "IG is licensed under the terms o the GNU GPL v3."))
        self.pushButton.setText(_translate("About", "OK"))
